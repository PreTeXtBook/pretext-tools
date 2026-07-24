import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver-types";
import { scanDocument, contextAt } from "../scan/scan-document";
import { isKnownAnyEnvironment } from "../data/environments";
import { isKnownMacro } from "../data/macros";
import { isKnownMathMacro } from "../data/math";
import { rangeFromOffsets } from "../util/position";

const SOURCE = "pretext-latex";

/**
 * Parse-level validation for LaTeX-style PreTeXt. Reports unmatched
 * environments, environments/macros the PreTeXt conversion does not support,
 * and nothing inside comments or verbatim blocks (the scanner already excludes
 * those). Positions come straight from the scanner's offsets.
 */
export function getLatexDiagnostics(text: string): Diagnostic[] {
  const scan = scanDocument(text);
  const diagnostics: Diagnostic[] = [];
  const userMacros = collectUserDefinedMacros(text);

  // 1 & 2. Environment matching and unknown-environment checks.
  const stack: { name: string; start: number; end: number }[] = [];
  for (const occ of scan.environments) {
    if (occ.type === "begin") {
      stack.push({ name: occ.name, start: occ.start, end: occ.end });
      if (!isKnownAnyEnvironment(occ.name)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: rangeFromOffsets(text, occ.start, occ.end),
          source: SOURCE,
          message: `Environment "${occ.name}" is not supported by the PreTeXt conversion and will not convert.`,
        });
      }
    } else {
      const top = stack[stack.length - 1];
      if (top && top.name === occ.name) {
        stack.pop();
      } else if (stack.some((s) => s.name === occ.name)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: rangeFromOffsets(text, occ.start, occ.end),
          source: SOURCE,
          message: `\\end{${occ.name}} does not match the most recently opened environment${
            top ? ` (\\begin{${top.name}})` : ""
          }.`,
        });
      } else {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: rangeFromOffsets(text, occ.start, occ.end),
          source: SOURCE,
          message: `\\end{${occ.name}} has no matching \\begin{${occ.name}}.`,
        });
      }
    }
  }
  for (const open of stack) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: rangeFromOffsets(text, open.start, open.end),
      source: SOURCE,
      message: `\\begin{${open.name}} has no matching \\end{${open.name}}.`,
    });
  }

  // 3. Unknown-macro checks (mode-aware).
  for (const macro of scan.macros) {
    if (userMacros.has(macro.name)) continue;
    // A macro recognized in either mode is not "unknown" — a math macro used in
    // text (or vice versa) is at worst mis-placed, which we don't police here.
    // This keeps the noise floor low (e.g. `\mathbb` inside a `\newcommand`).
    if (isKnownMacro(macro.name) || isKnownMathMacro(macro.name)) continue;
    const mode = contextAt(scan, macro.start).mode;
    diagnostics.push({
      severity: DiagnosticSeverity.Information,
      range: rangeFromOffsets(text, macro.start, macro.end),
      source: SOURCE,
      message:
        mode === "math"
          ? `\\${macro.name} is not a KaTeX-supported math macro; it may not render.`
          : `\\${macro.name} is not a recognized PreTeXt macro; it may not convert.`,
    });
  }

  return diagnostics;
}

/**
 * Names defined in-document via `\newcommand`, `\renewcommand`,
 * `\providecommand`, or `\def`. Treated as known so the unknown-macro check
 * does not flag a user's own macros.
 */
function collectUserDefinedMacros(text: string): Set<string> {
  const names = new Set<string>();
  const declare = /\\(?:re|provide)?newcommand\*?\s*\{?\s*\\([a-zA-Z]+)/g;
  const def = /\\def\s*\\([a-zA-Z]+)/g;
  for (const re of [declare, def]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) names.add(m[1]);
  }
  return names;
}
