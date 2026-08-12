import { describe, expect, it } from "vitest";
import { importProjectFromFiles } from "./upload";
import { analyzeImportSources } from "./project/analyze";
import type { ImportedProjectSuccess } from "./types";

/** A book driver plus two chapters that each compile on their own. */
function multiRootFiles(): Record<string, string> {
  return {
    "book.tex": [
      "\\documentclass{book}",
      "\\newcommand{\\R}{\\mathbb{R}}",
      "\\title{Analysis}",
      "\\begin{document}",
      "\\chapter{Beginnings}",
      "The start.",
      "\\end{document}",
    ].join("\n"),
    "appendix.tex": [
      "\\documentclass{book}",
      "\\title{Tables of Data}",
      "\\begin{document}",
      "Some tabulated values.",
      "\\end{document}",
    ].join("\n"),
    "notation.tex": [
      "\\documentclass{article}",
      "\\newcommand{\\N}{\\mathbb{N}}",
      "\\begin{document}",
      "Symbols used throughout.",
      "\\end{document}",
    ].join("\n"),
  };
}

function run(
  files: Record<string, string>,
  options = {},
): ImportedProjectSuccess {
  const result = importProjectFromFiles(files, options);
  if ("pretextError" in result) {
    throw new Error(`unexpected error: ${result.pretextError}`);
  }
  return result;
}

describe("multi-root LaTeX uploads", () => {
  it("prefers a conventionally named driver as the main file", () => {
    const analysis = analyzeImportSources(multiRootFiles());

    expect(analysis.primary?.path).toBe("book.tex");
    expect(analysis.primary?.title).toBe("Analysis");
    expect(analysis.extraRoots.map((r) => r.path)).toEqual([
      "appendix.tex",
      "notation.tex",
    ]);
  });

  it("does not offer a file that the main document already inputs", () => {
    const analysis = analyzeImportSources({
      "main.tex":
        "\\documentclass{book}\n\\begin{document}\n\\input{ch1}\n\\end{document}",
      "ch1.tex": "\\chapter{One}\nText.",
    });

    expect(analysis.primary?.path).toBe("main.tex");
    expect(analysis.extraRoots).toEqual([]);
  });

  it("attaches extra roots as chapters of a book by default", () => {
    const result = run(multiRootFiles());

    expect(result.sourcePath).toBe("book.tex");
    expect(result.attachedRoots).toEqual([
      { path: "appendix.tex", title: "Tables of Data", level: "chapter" },
      // No \title in notation.tex, so its filename supplies the heading.
      { path: "notation.tex", title: "Notation", level: "chapter" },
    ]);

    const titles = result.project.divisions.map((d) => d.title);
    expect(titles).toContain("Beginnings");
    expect(titles).toContain("Tables of Data");
    expect(result.pretextSource).toContain("Some tabulated values.");
    expect(result.pretextSource).toContain("Symbols used throughout.");
  });

  it("attaches at section level when the main document is an article", () => {
    const result = run({
      "paper.tex":
        "\\documentclass{article}\n\\title{Paper}\n\\begin{document}\n\\section{Intro}\nBody.\n\\end{document}",
      "extra.tex":
        "\\documentclass{article}\n\\title{Extra Results}\n\\begin{document}\nMore.\n\\end{document}",
    });

    expect(result.documentKind).toBe("article");
    expect(result.attachedRoots[0]).toMatchObject({
      path: "extra.tex",
      level: "section",
      title: "Extra Results",
    });
    expect(result.pretextSource).toContain("Extra Results");
  });

  it("imports the main file alone when attaching is turned off", () => {
    const result = run(multiRootFiles(), { attachRoots: false });

    expect(result.attachedRoots).toEqual([]);
    expect(result.pretextSource).not.toContain("Some tabulated values.");
    // The extra roots are still reported, so a host can offer them later.
    expect(result.analysis.extraRoots.map((r) => r.path)).toEqual([
      "appendix.tex",
      "notation.tex",
    ]);
  });

  it("honours per-file level, title, and order choices", () => {
    const result = run(multiRootFiles(), {
      attachRoots: [
        { path: "notation.tex", level: "section", title: "Notation" },
        { path: "appendix.tex", include: false },
      ],
    });

    expect(result.attachedRoots).toEqual([
      { path: "notation.tex", title: "Notation", level: "section" },
    ]);
    expect(result.pretextSource).toContain("Notation");
    expect(result.pretextSource).not.toContain("Some tabulated values.");
  });

  it("does not double-wrap a file that opens with its own heading", () => {
    const result = run({
      "main.tex":
        "\\documentclass{book}\n\\title{B}\n\\begin{document}\n\\chapter{One}\nFirst.\n\\end{document}",
      "two.tex":
        "\\documentclass{book}\n\\begin{document}\n\\chapter{Two}\nSecond.\n\\end{document}",
    });

    const chapterTitles = result.project.divisions
      .filter((d) => d.type === "chapter")
      .map((d) => d.title);
    expect(chapterTitles).toEqual(["One", "Two"]);
  });

  it("hoists macros from an attached file's preamble", () => {
    const result = run({
      "main.tex":
        "\\documentclass{book}\n\\title{B}\n\\begin{document}\n\\chapter{One}\nFirst.\n\\end{document}",
      "two.tex":
        "\\documentclass{book}\n\\newcommand{\\N}{\\mathbb{N}}\n\\begin{document}\n\\chapter{Two}\nThe set $\\N$.\n\\end{document}",
    });

    expect(result.project.docinfo).toContain("\\newcommand{\\N}");
  });

  it("expands each attached root's own inputs before attaching", () => {
    const result = run({
      "main.tex":
        "\\documentclass{book}\n\\title{B}\n\\begin{document}\n\\chapter{One}\nFirst.\n\\end{document}",
      "two.tex":
        "\\documentclass{book}\n\\begin{document}\n\\chapter{Two}\n\\input{details}\n\\end{document}",
      "details.tex": "Deep detail.",
    });

    expect(result.pretextSource).toContain("Deep detail.");
    expect(result.attachedRoots.map((r) => r.path)).toEqual(["two.tex"]);
  });

  it("reports an attachment that is not in the upload", () => {
    const result = run(multiRootFiles(), {
      attachRoots: [{ path: "missing.tex" }],
    });

    expect(result.attachedRoots).toEqual([]);
    expect(
      result.warnings.some((w) => w.category === "attached_root_missing"),
    ).toBe(true);
  });
});
