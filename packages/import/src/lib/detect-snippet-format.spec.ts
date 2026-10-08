import { describe, expect, it } from "vitest";
import {
  containsXmlMarkup,
  detectSnippetFormat,
  scoreSnippetFormats,
} from "./detect-snippet-format";

describe("detectSnippetFormat: LaTeX", () => {
  it.each([
    ["environment", "\\begin{exercise}\nProve it.\n\\end{exercise}"],
    ["inline math", "Find the derivative of $x^2 + 3x$ at $x=1$."],
    ["command with argument", "Let $G$ be a \\emph{group} of order $n$."],
    ["display math", "\\[ \\int_0^1 x^2\\,dx = \\frac{1}{3} \\]"],
    ["dollar display math", "$$a^2 + b^2 = c^2$$"],
    ["paren math", "The value \\( \\alpha \\) is fixed."],
    ["label and ref", "See \\ref{thm-main} for details."],
    ["itemize", "\\begin{itemize}\n\\item One\n\\end{itemize}"],
    ["lone variable math", "Let $n$ be even."],
  ])("detects %s", (_label, text) => {
    expect(detectSnippetFormat(text)).toBe("latex");
  });
});

describe("detectSnippetFormat: Markdown", () => {
  it.each([
    ["heading", "# Homework 3\n\nDo the problems."],
    ["bullet list", "- First item\n- Second item"],
    ["ordered list", "1. First\n2. Second"],
    ["strong emphasis", "This is **important** to remember."],
    ["link", "See [the notes](https://example.com/notes) for more."],
    ["blockquote", "> A quoted remark."],
    ["fenced code", "```\nprint(1)\n```"],
  ])("detects %s", (_label, text) => {
    expect(detectSnippetFormat(text)).toBe("markdown");
  });
});

describe("detectSnippetFormat: declines", () => {
  it.each([
    ["plain prose", "Just a sentence I copied from a book."],
    ["empty", "   \n  "],
    ["PreTeXt markup", "<p>Already <em>PreTeXt</em>.</p>"],
    ["currency", "The book costs $5 and the workbook costs $7."],
    ["snake_case identifier", "Call the compute_total_value function twice."],
    ["a bare asterisk", "The answer is 5 * 3 = 15."],
    ["prose with a hyphen", "Well - that was unexpected."],
    // PreTeXt partway through: the LaTeX is already inside the element it
    // belongs in, and converting would escape the tags into text.
    ["PreTeXt math mid-sentence", "This is math: <m>\\frac{1}{2}</m>."],
    [
      "PreTeXt math beside LaTeX",
      "Let <m>x \\in \\mathbb{R}</m> and \\emph{note} it.",
    ],
    ["a self-closing PreTeXt tag", 'See \\emph{this}, <xref ref="thm-a"/>.'],
    ["a start tag with an attribute", 'Now <url href="https://x.org">\\alpha'],
    ["an XML comment", "<!-- todo --> Let $x^2$ be \\emph{big}."],
    ["Markdown with HTML in it", "Some **bold** and <sup>2</sup> here."],
  ])("leaves %s alone", (_label, text) => {
    expect(detectSnippetFormat(text)).toBeUndefined();
  });
});

describe("containsXmlMarkup", () => {
  it.each([
    ["an end tag", "x</m>"],
    ["a self-closing tag", "<nbsp/>"],
    [
      "a self-closing tag with attributes",
      '<xref ref="a" text="type-global" />',
    ],
    ["a start tag with an attribute", "<p xml:id='p1'>"],
    ["a comment", "a <!-- b"],
    ["a CDATA section", "<![CDATA[x"],
  ])("finds %s", (_label, text) => {
    expect(containsXmlMarkup(text)).toBe(true);
  });

  it.each([
    ["an inequality", "Suppose $a<b$ and $c > d$."],
    ["a chained inequality", "$0<x<1$"],
    ["a bare start tag", "Typed <m> and stopped."],
    ["a Markdown autolink", "See <https://example.com/notes/> for more."],
    ["a TikZ arrow", "\\draw[<->] (0,0) -- (1,1);"],
  ])("ignores %s", (_label, text) => {
    expect(containsXmlMarkup(text)).toBe(false);
  });

  it("does not cost LaTeX that compares with < its conversion", () => {
    expect(detectSnippetFormat("If $a<b$ then \\emph{stop}.")).toBe("latex");
  });
});

describe("scoring", () => {
  it("prefers LaTeX when a snippet carries both languages' marks", () => {
    // Emphasis stars plus real math: the math is the stronger signal.
    expect(detectSnippetFormat("A *word* and $\\alpha_1$ here.")).toBe("latex");
  });

  it("needs more than one weak hint", () => {
    const { latex } = scoreSnippetFormats("The value \\alpha matters.");
    expect(latex).toBeLessThan(2);
    expect(detectSnippetFormat("The value \\alpha matters.")).toBeUndefined();
  });

  it("scores an unmistakable snippet well clear of the floor", () => {
    expect(
      scoreSnippetFormats("\\begin{theorem}$x^2$\\end{theorem}").latex,
    ).toBeGreaterThanOrEqual(5);
  });
});
