// Curated table of text-mode macros supported by the PreTeXt conversion.
//
// Source of truth (mirror, not import):
//   unified-latex/packages/unified-latex-to-pretext/libs/pre-conversion-subs/macro-subs.ts
// Signatures use unified-latex notation: "m" = {} arg, "o" = [] arg.
// Math-mode macros live in ./math (the KaTeX support list), not here.

import type { MacroSpec } from "../types";

/** Build several specs that share a signature, mode, and (no) documentation. */
function group(names: string[], signature: string): MacroSpec[] {
  return names.map((name) => ({ name, signature, mode: "text" as const }));
}

const NO_ARG = group(
  [
    // Generator / symbol macros that emit a fixed element with no arguments.
    "latex",
    "Latex",
    "LaTeX",
    "latexe",
    "today",
    "tex",
    "eg",
    "ie",
    "etc",
    "XeTeX",
    "XeLaTeX",
    "xelatex",
    "LuaTeX",
    "luatex",
    "PreTeXt",
    "pretext",
    "Pretext",
    "PreFigure",
    "webwork",
    "WeBWorK",
    "AD",
    "ad",
    "BC",
    "bc",
    "AM",
    "am",
    "PM",
    "pm",
    "nb",
    "ps",
    "vs",
    "viz",
    "etal",
    "circa",
    "ca",
    "timeofday",
    "mdash",
    "ndash",
    "nbsp",
    "P",
    "S",
    "copyright",
    "registered",
    "trademark",
    "degree",
    "textdegree",
    "dagger",
    "ddagger",
    "ldots",
    "dots",
    "textpm",
    "textregistered",
    "texttrademark",
    "textsection",
    "textpilcrow",
    "textperiodcentered",
    "texttildelow",
    "textperthousand",
    "centering",
    "noindent",
  ],
  "",
);

const ONE_ARG = group(
  [
    // Text-formatting wrappers.
    "emph",
    "textrm",
    "textsf",
    "texttt",
    "textsl",
    "textit",
    "textbf",
    "underline",
    "mbox",
    "phantom",
    "vspace",
    "hspace",
    "textsize",
    "makebox",
    // Inline PreTeXt elements.
    "term",
    "code",
    "lstinline",
    "fn",
    "footnote",
    "q",
    "sq",
    "enquote",
    "enquotestar",
    "abbr",
    "ac",
    "acro",
    "init",
    "foreign",
    "foreignlanguage",
    "booktitle",
    "pubtitle",
    "articletitle",
    "xmltag",
    "xmlattr",
    "taxon",
    "kbd",
    "icon",
    "sout",
    "insert",
    "stale",
    // Cross references and citations.
    "ref",
    "eqref",
    "cref",
    "Cref",
    "cite",
    "index",
    "url",
    "appendix",
    "caption",
  ],
  "m",
);

/** Macros with bespoke signatures or documentation worth surfacing. */
const SPECIAL: MacroSpec[] = [
  {
    name: "href",
    signature: "m m",
    mode: "text",
    snippet: "href{${1:url}}{$2}",
    documentation: "External link. `\\href{url}{text}` → `<url>`.",
  },
  {
    name: "hyperref",
    signature: "o m",
    mode: "text",
    snippet: "hyperref[${1:label}]{$2}",
    documentation: "Internal link to a `\\label`. `\\hyperref[label]{text}`.",
  },
  {
    name: "textcolor",
    signature: "m m",
    mode: "text",
    documentation: "No PreTeXt equivalent; converted to `<em>`.",
  },
  {
    name: "includegraphics",
    signature: "o m",
    mode: "text",
    snippet: "includegraphics{${1:source}}",
    documentation: "Image. Converts to `<image>` with a `source` attribute.",
  },
  {
    name: "term",
    signature: "m",
    mode: "text",
    snippet: "term{$1}",
    documentation: "A defined term. Converts to `<term>`.",
  },
  {
    name: "fillin",
    signature: "",
    mode: "text",
    documentation: "A blank to fill in. Converts to `<fillin>`.",
  },
];

/**
 * Division macros that behave like `\section` (title argument). Handled by the
 * converter's `break-on-boundaries` pass, not `macroReplacements` — mirrors
 * `divisionGroups` in
 *   unified-latex/.../pre-conversion-subs/break-on-boundaries.ts
 * plus the document-root macros in `provides.ts`. Signature simplified to the
 * common `\section{title}` form for completion purposes.
 */
const DIVISION = group(
  [
    "book",
    "article",
    "slideshow",
    "part",
    "chapter",
    "section",
    "subsection",
    "subsubsection",
    "paragraph",
    "subparagraph",
    "bibliography",
    "references",
  ],
  "m",
);

/**
 * Standard LaTeX document macros unified-latex parses natively. Listed so lint
 * does not flag them; the converter consumes them for metadata/structure.
 */
const DOCUMENT = [
  ...group(["title", "author", "date", "input", "include", "subtitle"], "m"),
  ...group(["documentclass", "usepackage"], "o m"),
  ...group(["newcommand", "renewcommand", "providecommand"], "m m"),
  ...group(
    [
      "maketitle",
      "tableofcontents",
      "frontmatter",
      "mainmatter",
      "backmatter",
      "item", // list item; may take an optional [label] but is usually bare
      "par",
      "newline",
    ],
    "",
  ),
];

/**
 * Font-switching "streaming" commands the converter rewrites to inline tags.
 * Mirrors `streamingMacroReplacements` in
 *   unified-latex/.../pre-conversion-subs/streaming-command-subs.ts
 */
const STREAMING = group(
  [
    "bfseries",
    "itshape",
    "rmfamily",
    "scshape",
    "sffamily",
    "slshape",
    "ttfamily",
    "normalfont",
    "color",
    "Huge",
    "huge",
    "LARGE",
    "Large",
    "large",
    "normalsize",
    "small",
    "footnotesize",
    "scriptsize",
    "tiny",
  ],
  "",
);

/**
 * Item macros from the `exam` document class. Mirrors `examMacros` /
 * `EXAM_ITEM_MACROS` in the converter's `exam-subs.ts`.
 */
const EXAM = group(["question", "subpart", "subsubpart"], "");

/** Names carrying a bespoke entry in SPECIAL, to drop from the grouped lists. */
const OVERRIDDEN = new Set(SPECIAL.map((m) => m.name));

export const MACROS: MacroSpec[] = [
  ...SPECIAL,
  ...[...NO_ARG, ...ONE_ARG, ...DIVISION, ...DOCUMENT, ...STREAMING, ...EXAM]
    .filter((m) => !OVERRIDDEN.has(m.name))
    // De-duplicate names that appear in more than one group (e.g. `part`).
    .filter((m, i, all) => all.findIndex((o) => o.name === m.name) === i),
];

export const MACRO_BY_NAME: ReadonlyMap<string, MacroSpec> = new Map(
  MACROS.map((m) => [m.name, m]),
);

export function isKnownMacro(name: string): boolean {
  return MACRO_BY_NAME.has(name);
}
