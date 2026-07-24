import { describe, it, expect } from "vitest";
import { scanDocument, contextAt } from "./scan-document";

/** Offset of the cursor marker "|" in a fixture, and the text with it removed. */
function cursor(fixture: string): { text: string; offset: number } {
  const offset = fixture.indexOf("|");
  if (offset === -1) throw new Error("fixture must contain a | cursor marker");
  return { text: fixture.replace("|", ""), offset };
}

function contextIn(fixture: string) {
  const { text, offset } = cursor(fixture);
  return contextAt(scanDocument(text), offset);
}

describe("scanDocument", () => {
  it("harvests labels with their offsets", () => {
    const text = "\\begin{theorem}\\label{thm:main}\n$x$\n\\label{eq:one}";
    const { labels } = scanDocument(text);
    expect(labels.map((l) => l.name)).toEqual(["thm:main", "eq:one"]);
    expect(text.slice(labels[0].offset, labels[0].offset + 8)).toBe("thm:main");
  });

  it("records begin/end environment occurrences", () => {
    const { environments } = scanDocument(
      "\\begin{theorem}\nhi\n\\end{theorem}",
    );
    expect(environments.map((e) => [e.name, e.type])).toEqual([
      ["theorem", "begin"],
      ["theorem", "end"],
    ]);
  });

  it("captures environment names containing hyphens and stars", () => {
    const { environments } = scanDocument(
      "\\begin{reading-questions}\\end{reading-questions}\\begin{align*}\\end{align*}",
    );
    expect(environments.map((e) => e.name)).toEqual([
      "reading-questions",
      "reading-questions",
      "align*",
      "align*",
    ]);
  });

  it("does not confuse \\end with \\endgroup", () => {
    const { environments } = scanDocument("\\endgroup \\end{itemize}");
    expect(environments).toHaveLength(1);
    expect(environments[0].name).toBe("itemize");
  });
});

describe("math-mode detection", () => {
  it("is math inside $...$", () => {
    expect(contextIn("text $x + |y$ more").mode).toBe("math");
  });

  it("is text outside inline math", () => {
    expect(contextIn("text $x$ mo|re").mode).toBe("text");
  });

  it("handles \\(...\\) and \\[...\\]", () => {
    expect(contextIn("a \\( x |y \\) b").mode).toBe("math");
    expect(contextIn("a \\[ x |y \\] b").mode).toBe("math");
  });

  it("treats an escaped dollar as literal, not math", () => {
    expect(contextIn("costs \\$5 and is fi|ne").mode).toBe("text");
  });

  it("is math inside a display math environment", () => {
    expect(contextIn("\\begin{align}\n x &= |1 \n\\end{align}").mode).toBe(
      "math",
    );
  });
});

describe("comment and verbatim suppression", () => {
  it("flags offsets inside a % comment", () => {
    const ctx = contextIn("real text % a comment wi|th $x$\nnext");
    expect(ctx.inComment).toBe(true);
  });

  it("does not open math from a $ inside a comment", () => {
    // The $ is inside the comment, so the word after the newline is text.
    expect(contextIn("% price is $5\nplain te|xt").mode).toBe("text");
  });

  it("does not push environments begun inside verbatim", () => {
    const ctx = contextIn(
      "\\begin{program}\n\\begin{theorem} still co|de\n\\end{program}",
    );
    expect(ctx.inVerbatim).toBe(true);
    expect(ctx.envStack).toEqual(["program"]);
  });

  it("closes the verbatim env at its matching \\end", () => {
    const ctx = contextIn("\\begin{code}\nx\n\\end{code}\naf|ter");
    expect(ctx.inVerbatim).toBe(false);
    expect(ctx.envStack).toEqual([]);
  });
});

describe("environment stack", () => {
  it("reports the innermost open environment", () => {
    const ctx = contextIn(
      "\\begin{exercises}\n\\begin{exercise}\nno|w\n\\end{exercise}\n\\end{exercises}",
    );
    expect(ctx.envStack).toEqual(["exercises", "exercise"]);
    expect(ctx.currentEnvironment).toBe("exercise");
  });

  it("pops nested environments correctly", () => {
    const ctx = contextIn("\\begin{a}\\begin{b}\\end{b}\naf|ter\n\\end{a}");
    expect(ctx.envStack).toEqual(["a"]);
  });

  it("does not count an environment whose \\begin straddles the cursor", () => {
    // Cursor sits inside the `\begin{theo` token itself.
    const ctx = contextIn("\\begin{theo|rem}");
    expect(ctx.envStack).toEqual([]);
  });
});
