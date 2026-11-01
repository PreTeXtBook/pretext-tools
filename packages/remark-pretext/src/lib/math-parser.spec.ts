import { describe, it, expect } from "vitest";
import { splitTextWithMath, tokenizeMathInMarkdown } from "./math-parser.js";

describe("math-parser - splitTextWithMath", () => {
  it("finds LaTeX \\[ \\] delimiters", () => {
    const result = splitTextWithMath("\\[a^2\\]");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("math");
    expect(result[0].value).toBe("a^2");
    expect(result[0].meta).toBe("display");
  });

  it("finds LaTeX \\( \\) delimiters", () => {
    const result = splitTextWithMath("text \\(x^2\\) more");
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("math");
    expect(result[1].value).toBe("x^2");
    expect(result[1].meta).toBe("inline");
  });

  it("finds $$ delimiters", () => {
    const result = splitTextWithMath("$$a^2$$");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("math");
    expect(result[0].value).toBe("a^2");
  });

  it("finds $ delimiters", () => {
    const result = splitTextWithMath("text $x^2$ more");
    expect(result).toHaveLength(3);
    expect(result[1].type).toBe("math");
    expect(result[1].value).toBe("x^2");
    expect(result[1].meta).toBe("inline");
  });

  it("handles text without math", () => {
    const result = splitTextWithMath("just text");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect(result[0].value).toBe("just text");
  });

  it("leaves dollar amounts as text", () => {
    const result = splitTextWithMath("$2 to $5 dollars");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });
});

describe("math-parser - which $ are delimiters", () => {
  const math = (text: string) =>
    [...tokenizeMathInMarkdown(text).tokens.values()].map((m) => m.value);

  it.each([
    ["Let $x$ be", ["x"]],
    ["$x$", ["x"]],
    ["punctuation after: $x$, $y$.", ["x", "y"]],
    ["brackets ($x$) and [$y$]", ["x", "y"]],
    ["a $k$-cycle", ["k"]],
    ["it's $x$'s value", ["x"]],
    ["$a$/$b$", ["a", "b"]],
    ["inner spaces $x + y$ are fine", ["x + y"]],
  ])("treats %s as math", (text, expected) => {
    expect(math(text)).toEqual(expected);
  });

  it.each([
    "$2 to $5 dollars",
    "It costs $5 today.",
    "Pay $5-$10 today",
    "From $20,000 to $30,000 total",
    "It costs $5 today.\n\nAnd also $6 tomorrow.",
    "It costs $5 today,\nand also $6 tomorrow.",
    "padded $ x $ math",
    "padded $x $ on one side",
    "padded $ x$ on the other",
    "mid-word a$b$c",
    "the $n$th term",
    "90$^\\circ$ angle",
    "see https://ex.com/a$b and https://ex.com/c$d",
    "cost $5 and `$` is code",
  ])("treats %s as text", (text) => {
    expect(math(text)).toEqual([]);
  });

  it("does not let an unclosed $ take over the rest of the document", () => {
    expect(math("It costs $5.\n\nThen $x^2$ is math.")).toEqual(["x^2"]);
    expect(math("It costs $5 and $x$ is math.")).toEqual(["x"]);
    expect(math("$$ unmatched and $x$ here")).toEqual(["x"]);
  });

  it("does not treat an escaped $ as a delimiter", () => {
    expect(math("It costs \\$5 and \\$6 today.")).toEqual([]);
    expect(math("Pay \\$5 for $x$.")).toEqual(["x"]);
    expect(math("$a = \\$5$ ok")).toEqual(["a = \\$5"]);
    expect(math("a line break \\\\$x$")).toEqual(["x"]);
  });

  it("still lets display math span lines", () => {
    expect(math("$$\na\nb\n$$")).toEqual(["\na\nb\n"]);
  });
});

describe("math-parser - tokenizeMathInMarkdown", () => {
  it("tokenizes inline math outside code spans", () => {
    const { markdown, tokens } = tokenizeMathInMarkdown(
      "Let $x^2$ be a value.",
    );
    expect(tokens.size).toBe(1);
    const [token, math] = [...tokens.entries()][0];
    expect(markdown).toContain(token);
    expect(math.value).toBe("x^2");
    expect(math.meta).toBe("inline");
  });

  it("does not tokenize $ inside a backtick code span", () => {
    const { markdown, tokens } = tokenizeMathInMarkdown("Use `$x$` here.");
    // No math tokens should be produced; the code span is copied verbatim
    expect(tokens.size).toBe(0);
    expect(markdown).toBe("Use `$x$` here.");
  });

  it("does not tokenize $ inside a fenced code block", () => {
    const { markdown, tokens } = tokenizeMathInMarkdown("```\n$x = 1$\n```");
    expect(tokens.size).toBe(0);
    expect(markdown).toBe("```\n$x = 1$\n```");
  });

  it("tokenizes math after a code span", () => {
    const { markdown, tokens } = tokenizeMathInMarkdown("`code` then $x^2$.");
    expect(tokens.size).toBe(1);
    const [, math] = [...tokens.entries()][0];
    expect(math.value).toBe("x^2");
    // The code span is preserved verbatim
    expect(markdown.startsWith("`code`")).toBe(true);
  });

  it("handles mixed code spans and math", () => {
    const { markdown, tokens } = tokenizeMathInMarkdown(
      "Use `$a$` and also $b^2$.",
    );
    // Only the second $ expression should be tokenized
    expect(tokens.size).toBe(1);
    const [, math] = [...tokens.entries()][0];
    expect(math.value).toBe("b^2");
    expect(markdown).toContain("`$a$`");
  });
});
