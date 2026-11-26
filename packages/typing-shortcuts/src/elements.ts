/**
 * The PreTeXt vocabulary the shortcuts consult to decide where they apply.
 */

/** Elements whose content is LaTeX math. */
export const MATH_ELEMENTS: ReadonlySet<string> = new Set([
  "m",
  "me",
  "men",
  "md",
  "mdn",
  "mrow",
]);

/**
 * Elements whose content is verbatim code, where a `$` is never a math
 * delimiter (a shell prompt, a Sage cell).
 */
export const VERBATIM_ELEMENTS: ReadonlySet<string> = new Set([
  "c",
  "cd",
  "cline",
  "pre",
  "program",
  "console",
  "input",
  "output",
  "sage",
  "latex-image",
]);

/** List elements, whose children are `<li>`s. */
export const LIST_ELEMENTS: ReadonlySet<string> = new Set(["ul", "ol", "dl"]);

/**
 * Divisions and other structural containers. An empty paragraph at the end of
 * one is just an empty paragraph: stepping out of a section to "the next
 * thing" is never what an Enter means.
 */
export const DIVISION_ELEMENTS: ReadonlySet<string> = new Set([
  "pretext",
  "book",
  "article",
  "slideshow",
  "frontmatter",
  "backmatter",
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraphs",
  "appendix",
  "preface",
  "acknowledgement",
  "foreword",
  "dedication",
  "colophon",
  "biography",
  "exercises",
  "subexercises",
  "worksheet",
  "handout",
  "page",
  "reading-questions",
  "glossary",
  "references",
  "solutions",
  "slide",
]);

/**
 * Elements inside which neither a new `<p>` nor a block environment can
 * start: math, verbatim code, one-line text containers, and lists (whose
 * paragraphs belong in an `<li>`). `<p>` itself is handled separately, since
 * inside one the paragraph shortcuts split it instead.
 */
export const NON_BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  ...MATH_ELEMENTS,
  ...VERBATIM_ELEMENTS,
  "title",
  "subtitle",
  "shorttitle",
  "plaintitle",
  "caption",
  "idx",
  "h",
  "ol",
  "ul",
  "dl",
  "tabular",
  "row",
]);
