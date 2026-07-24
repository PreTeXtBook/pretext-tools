// Math-mode support is shared with the LaTeX flavor: both flavors accept the
// same `$…$`, `$$…$$`, `\(…\)`, `\[…\]` delimiters and validate against the
// same KaTeX list. Re-export from `@pretextbook/latex-style-pretext` so there is
// exactly one vendored KaTeX support list across the two packages.
export {
  KATEX_MACROS,
  KATEX_ENVIRONMENTS,
  EXTRA_MATH_MACROS,
  isKnownMathMacro,
  isKnownMathEnvironment,
} from "@pretextbook/latex-style-pretext";
