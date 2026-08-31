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

/**
 * The depth-indexed divisions, outermost first (SPEC §9.3). Retargeting an
 * imported fragment onto a chosen level shifts tags along this ladder. Every
 * other division tag names a *role* rather than a depth — an `<exercises>` is
 * an exercises wherever it sits — so retargeting leaves them alone.
 *
 * Matches `LATEX_DIVISION_COMMANDS` (latex-split.ts) rung for rung, since the
 * LaTeX sectioning commands are where most imported hierarchies come from.
 */
export const DIVISION_LADDER = [
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
] as const;

export type LadderTag = (typeof DIVISION_LADDER)[number];

/**
 * Where content pushed past the bottom of the ladder lands. `<paragraphs>` is
 * deliberately absent from `PRETEXT_DIVISION_TAGS`, so overflow stays inline
 * and can never be split into a file of its own — the overflow rule and the
 * splitter agree without either referring to the other (SPEC §9.3).
 */
export const LADDER_OVERFLOW_TAG = "paragraphs";

/** Rung index of a tag on the ladder, or `-1` when it is off the ladder. */
export function ladderDepth(name: string): number {
  return (DIVISION_LADDER as readonly string[]).indexOf(name);
}

/**
 * Shift a tag `delta` rungs down the ladder. Off-ladder tags pass through
 * untouched; anything pushed past the last rung becomes `<paragraphs>`.
 */
export function shiftLadderTag(name: string, delta: number): string {
  const depth = ladderDepth(name);
  if (depth < 0) return name;
  const shifted = depth + delta;
  if (shifted >= DIVISION_LADDER.length) return LADDER_OVERFLOW_TAG;
  return DIVISION_LADDER[Math.max(0, shifted)];
}
