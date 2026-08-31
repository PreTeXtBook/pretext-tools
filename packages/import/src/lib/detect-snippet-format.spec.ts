import { describe, expect, it } from "vitest";
import {
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
  ])("leaves %s alone", (_label, text) => {
    expect(detectSnippetFormat(text)).toBeUndefined();
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
