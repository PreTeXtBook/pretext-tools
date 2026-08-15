import { describe, expect, it } from "vitest";
import {
  divisionsAtLevel,
  findLatexHeaders,
  latexDivisionHierarchy,
  LARGE_DOCUMENT_CHARS,
  parseLatexDivisions,
  suggestSplitLevel,
} from "./latex-split";

const book = [
  "\\chapter{One}\\label{ch:one}",
  "intro text",
  "\\section{Alpha}",
  "alpha text",
  "\\subsection{Deep}",
  "deep text",
  "\\section{Beta}",
  "beta text",
  "\\chapter{Two}",
  "two text",
].join("\n");

describe("findLatexHeaders", () => {
  it("finds every sectioning command at brace depth 0", () => {
    expect(findLatexHeaders(book).map((h) => h.command)).toEqual([
      "chapter",
      "section",
      "subsection",
      "section",
      "chapter",
    ]);
  });

  it("ignores sectioning commands nested inside braces", () => {
    const source =
      "\\newcommand{\\x}{\\section{Not a division}}\n\\section{Real}";
    const headers = findLatexHeaders(source);
    expect(headers).toHaveLength(1);
    expect(headers[0].rawTitle).toBe("Real");
  });

  it("is not derailed by escaped braces", () => {
    const source = "text \\{ still depth zero \\}\n\\section{Real}";
    expect(findLatexHeaders(source)).toHaveLength(1);
  });

  it("takes the starred form and an optional short title", () => {
    const headers = findLatexHeaders("\\section*[Short]{Long Title}");
    expect(headers[0].rawTitle).toBe("Long Title");
  });

  it("captures a \\label that follows the header", () => {
    expect(findLatexHeaders(book)[0].labelId).toBe("ch:one");
  });

  it("scans a large document without quadratic blow-up", () => {
    const big = Array.from(
      { length: 400 },
      (_, i) => `\\section{S${i}}\n${"body text ".repeat(200)}`,
    ).join("\n");
    const started = Date.now();
    expect(findLatexHeaders(big)).toHaveLength(400);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("latexDivisionHierarchy", () => {
  it("reports only the levels a document uses", () => {
    expect(latexDivisionHierarchy(book)).toEqual([
      "chapter",
      "section",
      "subsection",
    ]);
  });

  it("puts an article's sections at the top of its own hierarchy", () => {
    const article = "\\section{A}\nx\n\\subsection{B}\ny";
    expect(latexDivisionHierarchy(article)).toEqual(["section", "subsection"]);
    expect(parseLatexDivisions(article)[0].level).toBe(1);
  });
});

describe("parseLatexDivisions", () => {
  it("nests divisions by their level", () => {
    const roots = parseLatexDivisions(book);
    expect(roots.map((r) => r.title)).toEqual(["One", "Two"]);
    expect(roots[0].children.map((c) => c.title)).toEqual(["Alpha", "Beta"]);
    expect(roots[0].children[0].children.map((c) => c.title)).toEqual(["Deep"]);
  });

  it("ends a division where the next sibling begins", () => {
    const roots = parseLatexDivisions(book);
    expect(roots[0].end).toBe(roots[1].start);
    expect(book.slice(roots[1].start, roots[1].end)).toContain("two text");
  });

  it("runs the last division to the end of the source", () => {
    const roots = parseLatexDivisions(book);
    expect(roots[roots.length - 1].end).toBe(book.length);
  });

  it("closes an ancestor when a shallower division follows a deep one", () => {
    const roots = parseLatexDivisions(book);
    const alpha = roots[0].children[0];
    // Alpha ends where Beta starts, even though Alpha's subsection sits between.
    expect(alpha.end).toBe(roots[0].children[1].start);
  });

  it("handles a part above chapters", () => {
    const roots = parseLatexDivisions("\\part{P}\n\\chapter{C}\nx");
    expect(roots[0].command).toBe("part");
    expect(roots[0].children[0].command).toBe("chapter");
  });

  it("returns nothing for a document with no divisions", () => {
    expect(parseLatexDivisions("just prose")).toEqual([]);
  });
});

describe("divisionsAtLevel", () => {
  it("collects across parents", () => {
    const roots = parseLatexDivisions(book);
    expect(divisionsAtLevel(roots, 2).map((d) => d.title)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });
});

describe("suggestSplitLevel", () => {
  const filler = (n: number) => "body ".repeat(n);

  it("keeps a small article whole", () => {
    expect(
      suggestSplitLevel("\\section{A}\nx\n\\section{B}\ny", "article"),
    ).toBe(0);
  });

  it("splits a large article at its sections", () => {
    const big = Array.from(
      { length: 6 },
      (_, i) => `\\section{S${i}}\n${filler(4000)}`,
    ).join("\n");
    expect(big.length).toBeGreaterThan(LARGE_DOCUMENT_CHARS);
    expect(suggestSplitLevel(big, "article")).toBeGreaterThanOrEqual(1);
  });

  it("does not split a large article with only one or two sections", () => {
    const big = `\\section{Only}\n${filler(20000)}`;
    expect(suggestSplitLevel(big, "article")).toBe(0);
  });

  it("splits a book at chapters by default", () => {
    expect(suggestSplitLevel("\\chapter{A}\nx\n\\chapter{B}\ny", "book")).toBe(
      1,
    );
  });

  it("goes deeper for a book with very large chapters", () => {
    const big = Array.from(
      { length: 4 },
      (_, i) =>
        `\\chapter{C${i}}\n` +
        Array.from(
          { length: 4 },
          (_, j) => `\\section{S${j}}\n${filler(3000)}`,
        ).join("\n"),
    ).join("\n");
    expect(suggestSplitLevel(big, "book")).toBeGreaterThanOrEqual(2);
  });

  it("never recommends deeper than the document is structured", () => {
    const big = `\\chapter{A}\n${filler(30000)}\n\\chapter{B}\n${filler(30000)}\n\\chapter{C}\n${filler(30000)}`;
    expect(suggestSplitLevel(big, "book")).toBe(1);
  });

  it("returns 0 when there is nothing to split", () => {
    expect(suggestSplitLevel("prose only", "article")).toBe(0);
  });
});
