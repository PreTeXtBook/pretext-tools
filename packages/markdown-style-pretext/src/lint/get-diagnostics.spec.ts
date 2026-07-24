import { describe, it, expect } from "vitest";
import { getMarkdownDiagnostics } from "./get-diagnostics";
import { DiagnosticSeverity } from "vscode-languageserver-types";

const messages = (text: string) =>
  getMarkdownDiagnostics(text).map((d) => d.message);

describe("directive fence matching", () => {
  it("accepts a well-formed document", () => {
    expect(getMarkdownDiagnostics(":::theorem\nHi\n:::\n")).toEqual([]);
  });

  it("flags an unclosed container fence", () => {
    const diags = getMarkdownDiagnostics(":::theorem\nHi\n");
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0].message).toContain("never closed");
  });

  it("flags a stray closing fence", () => {
    const diags = getMarkdownDiagnostics("text\n:::\n");
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0].message).toContain("no matching open");
  });

  it("accepts nested containers written with flexible equal colons", () => {
    expect(
      getMarkdownDiagnostics(":::exercise\n:::task\nx\n:::\n:::\n"),
    ).toEqual([]);
  });

  it("accepts explicitly-leveled nesting where each pair's counts match", () => {
    expect(
      getMarkdownDiagnostics("::::exercise\n:::task\nx\n:::\n::::\n"),
    ).toEqual([]);
  });

  it("flags a closing fence whose colon count does not match the open", () => {
    const diags = getMarkdownDiagnostics("::::theorem\nHi\n:::\n");
    const mismatch = diags.find((d) => d.message.includes("does not match"));
    expect(mismatch?.severity).toBe(DiagnosticSeverity.Error);
    // The unmatched `:::` leaves the theorem open, so that is flagged too.
    expect(diags.some((d) => d.message.includes("never closed"))).toBe(true);
  });
});

describe("python-style directives", () => {
  it("accepts a well-formed python-style directive", () => {
    expect(
      getMarkdownDiagnostics("Theorem:\n    A statement.\n\nAfter.\n"),
    ).toEqual([]);
  });

  it("does not require an explicit close for python directives", () => {
    // Reaches end of document with the directive open; the dedent-close is
    // implicit, so this is valid (no "never closed" error).
    expect(getMarkdownDiagnostics("Theorem:\n    A statement.\n")).toEqual([]);
  });

  it("does not flag a non-directive `Name:` line", () => {
    expect(getMarkdownDiagnostics("Summary:\n    indented text\n")).toEqual([]);
  });
});

describe("unknown directives", () => {
  it("warns on an unsupported container directive", () => {
    const diags = getMarkdownDiagnostics(":::bogus\n:::\n");
    expect(diags[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diags[0].message).toContain("not a supported PreTeXt directive");
  });

  it("never flags leaf (include) directives, whatever the name", () => {
    expect(getMarkdownDiagnostics('::anything{ref="x"}\n')).toEqual([]);
  });
});

describe("unknown math macros", () => {
  it("validates math macros against the KaTeX list", () => {
    expect(getMarkdownDiagnostics("Inline $\\frac{1}{2}$ here.")).toEqual([]);
    expect(messages("$ \\notamacro $")[0]).toContain("KaTeX");
  });

  it("ignores $ and macros inside fenced code and comments", () => {
    expect(getMarkdownDiagnostics("```\n$\\notamacro$\n```\n")).toEqual([]);
    expect(getMarkdownDiagnostics("<!-- $\\notamacro$ -->\n")).toEqual([]);
  });
});
