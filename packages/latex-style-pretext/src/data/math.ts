// Math-mode support: the set of macros and environments KaTeX (and therefore
// the PreTeXt math pipeline) understands.
//
// `katex-support.json` is vendored from:
//   unified-latex/packages/unified-latex-to-pretext/libs/katex-support.json
// Refresh it alongside the converter. `math`-mode completions and the
// "unknown math macro" lint check both read from these sets.

import katexSupport from "./katex-support.json";

/** Macro names (without backslash) KaTeX renders. */
export const KATEX_MACROS: ReadonlySet<string> = new Set(
  katexSupport.KATEX_MACROS,
);

/** Environment names valid inside math mode (align, equation, pmatrix, ...). */
export const KATEX_ENVIRONMENTS: ReadonlySet<string> = new Set(
  katexSupport.KATEX_ENVIRONMENTS,
);

/**
 * Extra math macros the converter special-cases beyond the KaTeX list
 * (mirrors `mathjaxSpecificMacroReplacements`).
 */
export const EXTRA_MATH_MACROS: ReadonlySet<string> = new Set([
  "systeme",
  "sysdelim",
]);

export function isKnownMathMacro(name: string): boolean {
  return KATEX_MACROS.has(name) || EXTRA_MATH_MACROS.has(name);
}

export function isKnownMathEnvironment(name: string): boolean {
  return KATEX_ENVIRONMENTS.has(name);
}
