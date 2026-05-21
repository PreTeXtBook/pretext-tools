// Ported from PreprocessLaTeX/src/main.js: fixPlainTeX, specialPreprocess.

import type { MacroReplaceGroup } from "./latex-data";
import type { CleaningWarning } from "./warnings";

function escapeRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function fixPlainTeX(
  input: string,
  group: MacroReplaceGroup,
): { output: string; warnings: CleaningWarning[] } {
  let output = input;
  const warnings: CleaningWarning[] = [];

  for (const { from, to } of group.pairs) {
    let lookForName: string;
    let replacement: string;

    if (group.category === "tex_fonts") {
      // {\bf foo} -> \textbf{foo
      lookForName = `\\{ *\\\\${escapeRegex(from)}\\b *`;
      replacement = `\\${to}{`;
    } else {
      lookForName = `\\\\${escapeRegex(from)}\\b *`;
      replacement = `\\${to}`;
    }

    const re = new RegExp(lookForName, "g");
    const matches = output.match(re);
    if (matches) {
      warnings.push({
        action: "replace",
        severity: "info",
        kind: group.kind,
        category: group.category,
        macro: from,
        replacement: to,
        occurrences: matches.length,
      });
      output = output.replace(re, replacement);
    }
  }

  return { output, warnings };
}

export function specialPreprocess(input: string): {
  output: string;
  warnings: CleaningWarning[];
} {
  let output = input;
  const warnings: CleaningWarning[] = [];

  const eqrefMatches = output.match(/\(\\ref\{([^{}]+)\}\)/g);
  if (eqrefMatches) {
    warnings.push({
      action: "rewrite",
      severity: "info",
      kind: "presentation",
      category: "math_refs",
      macro: "(\\ref{...})",
      replacement: "\\eqref{...}",
      occurrences: eqrefMatches.length,
    });
    output = output.replace(/\(\\ref\{([^{}]+)\}\)/g, "\\eqref{$1}");
  }

  output = output.replace(/(\\vfil)l\b/g, "$1");
  output = output.replace(/(\\vfil)(\s*\\vfil\b)+\b/g, "$1");

  const vfilMatches = output.match(/(\\vfil)\b/g);
  if (vfilMatches) {
    warnings.push({
      action: "rewrite",
      severity: "info",
      kind: "presentation",
      category: "spacing_vertical",
      macro: "vfil",
      replacement: "\\vspace{1in}",
      occurrences: vfilMatches.length,
    });
    output = output.replace(/(\\vfil)\b/g, "\\vspace{1in}");
  }

  output = output.replace(
    /\\vskip\*? *([0-9]+|-) *([a-zA-Z]+).*/g,
    "\\vspace{$1$2}",
  );
  output = output.replace(/(\\vspace)\*? */g, "$1");
  output = output.replace(
    /(\\vspace) *\{([0-9]+|-) *([a-zA-Z]+).*?\}/g,
    "$1{$2$3}",
  );

  return { output, warnings };
}
