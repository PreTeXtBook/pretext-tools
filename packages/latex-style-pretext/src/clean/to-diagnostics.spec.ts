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

  it("suggests PreTeXt elements for a macro it will not fix automatically", () => {
    const [diag] = getLatexCleanDiagnostics(
      "\\begin{document}\n\\textit{x}",
    ).filter((d) => d.code === "textit");
    expect(diag.message).toContain("<emph>");
    expect(diag.message).toContain("<term>");
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

  it("does not offer to guess at a flagged macro", () => {
    const text = "\\begin{document}\n\\textbf{important}";
    const actions = latexFixesToCodeActions(text, wholeDoc, { uri: URI });
    expect(actions.some((a) => a.title.includes("textbf"))).toBe(false);
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
