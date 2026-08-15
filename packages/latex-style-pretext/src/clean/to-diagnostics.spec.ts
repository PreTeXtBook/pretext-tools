import { describe, expect, it } from "vitest";
import {
  DiagnosticSeverity,
  CodeActionKind,
} from "vscode-languageserver-types";
import {
  CLEAN_SOURCE,
  getLatexCleanDiagnostics,
  latexFixesToCodeActions,
} from "./to-diagnostics";
import { findLatexFixes } from "./find-fixes";

const URI = "file:///doc.tex";
const wholeDoc = {
  start: { line: 0, character: 0 },
  end: { line: 99, character: 0 },
};

describe("getLatexCleanDiagnostics", () => {
  it("tags cleaning findings with their own source, not lint's", () => {
    const [first] = getLatexCleanDiagnostics("{\\bf x}");
    expect(first.source).toBe(CLEAN_SOURCE);
    expect(first.code).toBe("tex-font-bf");
  });

  it("positions a diagnostic on the offending text", () => {
    const text = "line one\n\\bigskip here";
    const [diag] = getLatexCleanDiagnostics(text, { scope: "body" });
    expect(diag.range).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 8 },
    });
  });

  it("warns on presentational font macros and only informs on deletions", () => {
    const diags = getLatexCleanDiagnostics(
      "\\begin{document}\n\\textbf{x} \\bigskip",
    );
    const flagged = diags.find((d) => d.code === "textbf");
    const deleted = diags.find(
      (d) => d.code === "smallskip" || d.code === "bigskip",
    );
    expect(flagged?.severity).toBe(DiagnosticSeverity.Warning);
    expect(deleted?.severity).toBe(DiagnosticSeverity.Information);
  });

  it("names the semantic macros to reach for instead", () => {
    const [diag] = getLatexCleanDiagnostics(
      "\\begin{document}\n\\textit{x}",
    ).filter((d) => d.code === "textit");
    expect(diag.message).toContain("\\emph");
    expect(diag.message).toContain("\\term");
    expect(diag.message).toContain("ordinary emphasis");
  });

  it("carries the rule id and span in data so a host can rebuild the edit", () => {
    const [diag] = getLatexCleanDiagnostics("{\\bf x}");
    expect(diag.data).toMatchObject({ ruleId: "tex-font-bf", start: 0 });
  });
});

describe("latexFixesToCodeActions", () => {
  it("offers a quick fix per editable occurrence", () => {
    const text = "{\\bf a} and {\\it b}";
    const actions = latexFixesToCodeActions(text, wholeDoc, { uri: URI });
    const quickFixes = actions.filter(
      (a) => a.kind === CodeActionKind.QuickFix,
    );
    expect(quickFixes.map((a) => a.title)).toEqual([
      "Replace \\bf with textbf",
      "Replace \\it with textit",
    ]);
  });

  it("offers one action per semantic alternative for a flagged macro", () => {
    const text = "\\begin{document}\n\\textbf{important}";
    const actions = latexFixesToCodeActions(text, wholeDoc, { uri: URI });
    expect(actions.map((a) => a.title)).toEqual([
      "Replace \\textbf with \\alert — something the reader must not miss",
      "Replace \\textbf with \\term — a term being defined",
      "Replace \\textbf with \\emph — ordinary emphasis",
    ]);
  });

  it("never folds a flagged macro into the bulk clean-up", () => {
    const text = "\\begin{document}\n\\textbf{important} \\bigskip";
    const cleanAll = latexFixesToCodeActions(text, wholeDoc, { uri: URI }).find(
      (a) => a.kind === CodeActionKind.SourceFixAll,
    );
    const [edit] = cleanAll!.edit!.changes![URI];
    expect(edit.newText).toContain("\\textbf{important}");
  });

  it("scopes quick fixes to the requested range", () => {
    const text = "{\\bf a}\n{\\it b}";
    const secondLine = {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 7 },
    };
    const actions = latexFixesToCodeActions(text, secondLine, {
      uri: URI,
      includeCleanAll: false,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toContain("\\it");
  });

  it("adds one whole-document edit for the bulk clean-up", () => {
    const text = "{\\bf a} \\bigskip";
    const actions = latexFixesToCodeActions(text, wholeDoc, { uri: URI });
    const cleanAll = actions.find(
      (a) => a.kind === CodeActionKind.SourceFixAll,
    );
    expect(cleanAll?.title).toMatch(/^Clean up LaTeX \(\d+ changes?\)$/);
    const edits = cleanAll?.edit?.changes?.[URI] ?? [];
    expect(edits).toHaveLength(1);
    expect(edits[0].newText).toBe("\\textbf{a} ");
  });

  it("omits the bulk action when there is nothing to clean", () => {
    const actions = latexFixesToCodeActions("plain text", wholeDoc, {
      uri: URI,
    });
    expect(actions).toEqual([]);
  });

  it("applies a single quick fix without disturbing the rest of the document", () => {
    const text = "{\\bf a} and {\\it b}";
    const actions = latexFixesToCodeActions(text, wholeDoc, {
      uri: URI,
      includeCleanAll: false,
    });
    const [edit] = actions[1].edit!.changes![URI];
    const lines = text.split("\n");
    const line = lines[edit.range.start.line];
    const patched =
      line.slice(0, edit.range.start.character) +
      edit.newText +
      line.slice(edit.range.end.character);
    expect(patched).toBe("{\\bf a} and \\textit{b}");
  });
});

describe("cursor-position code actions", () => {
  it("offers the fix whose span the cursor sits inside", () => {
    const text = "{\\bf a} and {\\it b}";
    const cursor = {
      start: { line: 0, character: 2 },
      end: { line: 0, character: 2 },
    };
    const actions = latexFixesToCodeActions(text, cursor, {
      uri: URI,
      includeCleanAll: false,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toContain("\\bf");
  });

  it("offers nothing when the cursor is nowhere near a finding", () => {
    const text = "{\\bf a} and plain text here";
    const cursor = {
      start: { line: 0, character: 20 },
      end: { line: 0, character: 20 },
    };
    const actions = latexFixesToCodeActions(text, cursor, {
      uri: URI,
      includeCleanAll: false,
    });
    expect(actions).toEqual([]);
  });
});

describe("findLatexFixes / diagnostics agreement", () => {
  it("produces exactly one diagnostic per fix", () => {
    const text = "\\begin{document}\n{\\bf a} \\bigskip \\textit{b}";
    expect(getLatexCleanDiagnostics(text)).toHaveLength(
      findLatexFixes(text).length,
    );
  });
});

describe("semantic alternatives (spell-check style)", () => {
  const twoBold =
    "\\begin{document}\n\\textbf{first} and \\textbf{second} and \\textit{other}";

  const titles = (text: string, range = wholeDoc) =>
    latexFixesToCodeActions(text, range, {
      uri: URI,
      includeCleanAll: false,
    }).map((a) => a.title);

  it("offers a replace-all twin once a macro appears more than once", () => {
    expect(titles(twoBold)).toContain("Replace all 2 \\textbf with \\alert");
  });

  it("offers no replace-all for a lone occurrence", () => {
    const single = "\\begin{document}\n\\textbf{only}";
    expect(titles(single).some((t) => t.startsWith("Replace all"))).toBe(false);
  });

  it("replace-all edits every occurrence of that macro", () => {
    const action = latexFixesToCodeActions(twoBold, wholeDoc, {
      uri: URI,
      includeCleanAll: false,
    }).find((a) => a.title === "Replace all 2 \\textbf with \\term")!;
    const edits = action.edit!.changes![URI];
    expect(edits).toHaveLength(2);
    expect(edits.every((e) => e.newText === "\\term")).toBe(true);
  });

  it("replace-all leaves a different presentational macro alone", () => {
    const action = latexFixesToCodeActions(twoBold, wholeDoc, {
      uri: URI,
      includeCleanAll: false,
    }).find((a) => a.title === "Replace all 2 \\textbf with \\alert")!;
    const applied = applyEdits(twoBold, action.edit!.changes![URI]);
    expect(applied).toContain("\\alert{first}");
    expect(applied).toContain("\\alert{second}");
    expect(applied).toContain("\\textit{other}");
  });

  it("a single-occurrence fix touches only the occurrence under the cursor", () => {
    const cursor = {
      start: { line: 1, character: 2 },
      end: { line: 1, character: 2 },
    };
    const action = latexFixesToCodeActions(twoBold, cursor, {
      uri: URI,
      includeCleanAll: false,
    }).find((a) => a.title.startsWith("Replace \\textbf with \\alert"))!;
    const applied = applyEdits(twoBold, action.edit!.changes![URI]);
    expect(applied).toContain("\\alert{first}");
    expect(applied).toContain("\\textbf{second}");
  });

  it("orders alternatives by the most likely reading", () => {
    const bold = titles("\\begin{document}\n\\textbf{x}");
    const italic = titles("\\begin{document}\n\\textit{x}");
    expect(bold[0]).toContain("\\alert");
    expect(italic[0]).toContain("\\emph");
  });

  it("offers alternatives for every flagged font macro", () => {
    for (const [macro, first] of [
      ["textbf", "\\alert"],
      ["textit", "\\emph"],
      ["texttt", "\\code"],
      ["textsc", "\\init"],
      ["textrm", "\\emph"],
    ] as const) {
      const offered = titles(`\\begin{document}\n\\${macro}{x}`);
      expect(offered.length, macro).toBeGreaterThan(0);
      expect(offered[0], macro).toContain(first);
    }
  });

  it("only offers macros the converter actually supports", async () => {
    const { MACRO_ALTERNATIVES } = await import("./rules");
    const { isKnownMacro } = await import("../data/macros");
    for (const alternatives of Object.values(MACRO_ALTERNATIVES)) {
      for (const alt of alternatives) {
        expect(isKnownMacro(alt.macro), `\\${alt.macro}`).toBe(true);
      }
    }
  });
});

/** Apply non-overlapping single-line edits, last first. */
function applyEdits(
  text: string,
  edits: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  }[],
): string {
  const lines = text.split("\n");
  for (const edit of [...edits].sort(
    (a, b) =>
      b.range.start.line - a.range.start.line ||
      b.range.start.character - a.range.start.character,
  )) {
    const line = lines[edit.range.start.line];
    lines[edit.range.start.line] =
      line.slice(0, edit.range.start.character) +
      edit.newText +
      line.slice(edit.range.end.character);
  }
  return lines.join("\n");
}
