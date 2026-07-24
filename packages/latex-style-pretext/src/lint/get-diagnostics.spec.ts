import { describe, it, expect } from "vitest";
import { getLatexDiagnostics } from "./get-diagnostics";
import { DiagnosticSeverity } from "vscode-languageserver-types";

const messages = (text: string) =>
  getLatexDiagnostics(text).map((d) => d.message);

describe("environment matching", () => {
  it("accepts a well-formed document", () => {
    expect(getLatexDiagnostics("\\begin{theorem}\nHi\n\\end{theorem}")).toEqual(
      [],
    );
  });

  it("flags an unclosed environment", () => {
    const diags = getLatexDiagnostics("\\begin{theorem}\nHi");
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0].message).toContain("no matching \\end{theorem}");
  });

  it("flags an orphan \\end", () => {
    expect(messages("text\n\\end{theorem}")[0]).toContain(
      "no matching \\begin{theorem}",
    );
  });

  it("flags mismatched nesting", () => {
    const diags = getLatexDiagnostics(
      "\\begin{a}\\begin{theorem}\\end{a}\\end{theorem}",
    );
    // \end{a} does not match the innermost \begin{theorem}.
    expect(diags.some((d) => d.message.includes("does not match"))).toBe(true);
  });
});

describe("unknown environments", () => {
  it("warns on an unsupported environment", () => {
    const diags = getLatexDiagnostics("\\begin{bogus}\n\\end{bogus}");
    expect(diags[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diags[0].message).toContain("not supported by the PreTeXt");
  });

  it("accepts math environments like align", () => {
    expect(getLatexDiagnostics("\\begin{align}\nx &= 1\n\\end{align}")).toEqual(
      [],
    );
  });

  it("accepts theorem aliases", () => {
    expect(getLatexDiagnostics("\\begin{thm}\nHi\n\\end{thm}")).toEqual([]);
  });
});

describe("unknown macros", () => {
  it("does not flag supported text macros or division macros", () => {
    expect(
      getLatexDiagnostics("\\section{Intro}\nA \\term{widget} here."),
    ).toEqual([]);
  });

  it("flags an unknown text macro at low severity", () => {
    const diags = getLatexDiagnostics("A \\bogusmacro here.");
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Information);
  });

  it("validates math macros against the KaTeX list", () => {
    expect(getLatexDiagnostics("$ \\frac{1}{2} $")).toEqual([]);
    expect(messages("$ \\notamacro $")[0]).toContain("KaTeX");
  });

  it("does not flag user-defined macros", () => {
    expect(
      getLatexDiagnostics(
        "\\newcommand{\\RR}{\\mathbb{R}}\nLet $x \\in \\RR$.",
      ),
    ).toEqual([]);
  });

  it("ignores macros inside comments and verbatim", () => {
    expect(getLatexDiagnostics("% \\bogus here")).toEqual([]);
    expect(
      getLatexDiagnostics("\\begin{program}\n\\bogus\n\\end{program}"),
    ).toEqual([]);
  });
});
