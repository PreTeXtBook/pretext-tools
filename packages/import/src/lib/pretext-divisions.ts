// The PreTeXt division vocabulary the import pipeline can split on.
//
// A "division" here means an element that can legitimately live in its own
// file behind an `xi:include` — which is also what pretext-plus stores as a
// division record (its own `SECTION_TAGS` matches this list). Elements that
// are structural but never chunked on their own (`<objectives>`, …) are
// deliberately absent: splitting them produces files no author would have
// written.

/** Root elements of a PreTeXt document. */
export const PRETEXT_ROOT_TAGS = ["book", "article"] as const;

/** Divisions that may be split into their own file, in rough outline order. */
export const PRETEXT_DIVISION_TAGS = [
  "frontmatter",
  "preface",
  "acknowledgement",
  "dedication",
  "biography",
  "contributors",
  "part",
  "introduction",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "conclusion",
  "exercises",
  "worksheet",
  "handout",
  "reading-questions",
  "references",
  "solutions",
  "glossary",
  "backmatter",
  "appendix",
  "index",
  "colophon",
] as const;

export type PretextRootTag = (typeof PRETEXT_ROOT_TAGS)[number];
export type PretextDivisionTag = (typeof PRETEXT_DIVISION_TAGS)[number];

const DIVISION_TAG_SET: ReadonlySet<string> = new Set(PRETEXT_DIVISION_TAGS);

export function isDivisionTag(name: string): name is PretextDivisionTag {
  return DIVISION_TAG_SET.has(name);
}

/**
 * Filename prefix for a division type. The common ones follow the PreTeXt
 * community's conventions (`ch-`, `sec-`); anything else uses its own tag, so
 * an appendix lands in `appendix-limits.ptx`.
 */
const FILE_PREFIXES: Record<string, string> = {
  chapter: "ch",
  section: "sec",
  subsection: "subsec",
  subsubsection: "subsubsec",
  appendix: "app",
};

export function filePrefixForDivision(type: string): string {
  return FILE_PREFIXES[type] ?? type;
}

/**
 * Divisions a document has at most one of. Their files are named for the
 * division itself (`frontmatter.ptx`, `preface.ptx`) rather than for an
 * xml:id nobody chose to be readable — which is also how the pretext-cli
 * project template names them.
 */
const SINGLETON_DIVISIONS: ReadonlySet<string> = new Set([
  "frontmatter",
  "backmatter",
  "preface",
  "acknowledgement",
  "dedication",
  "biography",
  "contributors",
  "colophon",
  "glossary",
  "index",
]);

export function isSingletonDivision(type: string): boolean {
  return SINGLETON_DIVISIONS.has(type);
}
