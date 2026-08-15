// Level-aware splitting of LaTeX source into a division tree.
//
// This replaces the chapter→section special case the native pool used to carry.
// The PreTeXt splitter (`division-pool.ts`) has always been depth-generic,
// driven by the division vocabulary and a `splitLevel`; this brings the LaTeX
// side to the same footing, so both formats answer to one number.

import { slugify } from "./layout/shared";
import type { DocumentKind } from "./layout/document-kind";

/**
 * LaTeX's sectioning commands, outermost first. A document's own hierarchy is
 * whichever of these it actually uses (`latexDivisionHierarchy`), so an article
 * that starts at `\section` gets sections at depth 1 rather than an empty level
 * standing in for the chapters it does not have.
 */
export const LATEX_DIVISION_COMMANDS = [
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
] as const;

export type LatexDivisionCommand = (typeof LATEX_DIVISION_COMMANDS)[number];

/** PreTeXt division tag for each LaTeX sectioning command. */
export const PRETEXT_TAG_FOR_COMMAND: Record<LatexDivisionCommand, string> = {
  part: "part",
  chapter: "chapter",
  section: "section",
  subsection: "subsection",
  subsubsection: "subsubsection",
};

export interface LatexDivision {
  command: LatexDivisionCommand;
  /** 1-based depth within the document's own hierarchy. */
  level: number;
  /** Raw LaTeX title as it appeared in the header's braces. */
  rawTitle: string;
  /** Title reduced to plain text. */
  title: string;
  /** Ref from a `\label` immediately after the header, if any. */
  labelId?: string;
  /** Offset of the header macro's backslash, in the original source. */
  start: number;
  /** Offset just past the header (and any consumed `\label`). */
  contentStart: number;
  /** Offset just past this division's content — the next sibling's `start`. */
  end: number;
  children: LatexDivision[];
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Read a balanced `{...}` group at/after `pos` (skipping leading whitespace). */
function readBraceGroup(
  text: string,
  pos: number,
): { inner: string; end: number } | null {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== "{") return null;
  const start = i;
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { inner: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Skip a balanced optional `[...]` group at/after `pos`, if present. */
function skipOptionalArg(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== "[") return pos;
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return pos;
}

/** Reduce a LaTeX title fragment to plain text. */
export function latexTitleToPlainText(tex: string): string {
  return tex
    .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, "$1") // \emph{x} → x
    .replace(/\\[a-zA-Z]+/g, "") // stray control words
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface RawHeader {
  command: LatexDivisionCommand;
  start: number;
  rawTitle: string;
  contentStart: number;
  labelId?: string;
}

/**
 * Every sectioning header in `source` at brace depth 0, in source order.
 *
 * One linear pass. The previous implementation re-counted brace depth from the
 * start of the document for every candidate match, which is quadratic in
 * document size — exactly the wrong shape for the large multi-section documents
 * this splitter exists to handle.
 */
export function findLatexHeaders(source: string): RawHeader[] {
  const headers: RawHeader[] = [];
  const commands = new Set<string>(LATEX_DIVISION_COMMANDS);
  let depth = 0;

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "{") {
      depth++;
      continue;
    }
    if (c === "}") {
      depth--;
      continue;
    }
    if (c !== "\\") continue;

    // Read the control word.
    let j = i + 1;
    while (j < source.length && /[a-zA-Z]/.test(source[j])) j++;
    if (j === i + 1) {
      // An escaped character (`\{`, `\%`, `\\`): skip both so it cannot
      // disturb the brace depth.
      i++;
      continue;
    }
    const name = source.slice(i + 1, j);
    if (depth !== 0 || !commands.has(name)) {
      i = j - 1;
      continue;
    }

    // `\section*` is still a section for splitting purposes.
    const afterStar = source[j] === "*" ? j + 1 : j;
    const title = readBraceGroup(source, skipOptionalArg(source, afterStar));
    if (!title) {
      i = j - 1;
      continue;
    }

    let contentStart = title.end;
    let labelId: string | undefined;
    const label = /^\s*\\label\s*\{([^{}]*)\}/.exec(source.slice(title.end));
    if (label) {
      labelId = label[1].trim();
      contentStart = title.end + label[0].length;
    }

    headers.push({
      command: name as LatexDivisionCommand,
      start: i,
      rawTitle: title.inner,
      contentStart,
      labelId,
    });
    i = contentStart - 1;
  }

  return headers;
}

/**
 * The sectioning commands this document actually uses, outermost first.
 *
 * Depth is relative to the document, not to LaTeX's absolute hierarchy: an
 * article whose outermost divisions are `\section`s has sections at depth 1, so
 * `splitLevel: 1` means the same thing ("split the top-level divisions") for
 * every document.
 */
export function latexDivisionHierarchy(source: string): LatexDivisionCommand[] {
  const present = new Set(findLatexHeaders(source).map((h) => h.command));
  return LATEX_DIVISION_COMMANDS.filter((cmd) => present.has(cmd));
}

/**
 * Parse `source` into a division tree. Offsets are absolute within `source`.
 *
 * Headers are already in source order, so the tree is built with a stack: a
 * header deeper than the stack top becomes its child, and anything at or above
 * the top pops until it finds its parent.
 */
export function parseLatexDivisions(source: string): LatexDivision[] {
  const hierarchy = latexDivisionHierarchy(source);
  const levelOf = new Map(hierarchy.map((cmd, index) => [cmd, index + 1]));
  const headers = findLatexHeaders(source);

  const roots: LatexDivision[] = [];
  const stack: LatexDivision[] = [];

  for (const header of headers) {
    const level = levelOf.get(header.command) ?? 1;
    const division: LatexDivision = {
      command: header.command,
      level,
      rawTitle: header.rawTitle,
      title: latexTitleToPlainText(header.rawTitle),
      labelId: header.labelId,
      start: header.start,
      contentStart: header.contentStart,
      end: source.length,
      children: [],
    };

    // Divisions are created spanning to end-of-source and closed as they are
    // popped, so an ancestor nothing follows keeps the right end automatically.
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()!.end = header.start;
    }

    if (stack.length === 0) roots.push(division);
    else stack[stack.length - 1].children.push(division);
    stack.push(division);
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Split depth
// ---------------------------------------------------------------------------

/** A document past this size is worth splitting one level deeper than default. */
export const LARGE_DOCUMENT_CHARS = 80_000;
/** A single division past this size is worth splitting, whatever the total. */
export const LARGE_DIVISION_CHARS = 40_000;
/** Below this many children, splitting a level just makes tiny files. */
export const MIN_DIVISIONS_TO_SPLIT = 3;
/** Deepest level `suggestSplitLevel` will recommend on its own. */
export const MAX_SUGGESTED_SPLIT_LEVEL = 3;

/** Every division at exactly `level` in the tree. */
export function divisionsAtLevel(
  roots: LatexDivision[],
  level: number,
): LatexDivision[] {
  if (level <= 1) return roots;
  return roots.flatMap((root) => divisionsAtLevel(root.children, level - 1));
}

/**
 * A sensible default split depth for `source`.
 *
 * The old default — chapters for a book, nothing for an article — left a
 * thirty-section article in one enormous file. This goes deeper while the
 * document (or one of its divisions) is still large and the next level down has
 * enough divisions to be worth its own files. Settles SPEC §8.7.
 */
export function suggestSplitLevel(
  source: string,
  documentKind: DocumentKind,
): number {
  const roots = parseLatexDivisions(source);
  if (roots.length === 0) return 0;

  // A book splits its chapters by default; an article is small enough to stay
  // whole unless the size check below says otherwise.
  let level = documentKind === "book" ? 1 : 0;
  const documentIsLarge = source.length > LARGE_DOCUMENT_CHARS;

  while (level < MAX_SUGGESTED_SPLIT_LEVEL) {
    const next = divisionsAtLevel(roots, level + 1);
    if (next.length < MIN_DIVISIONS_TO_SPLIT) break;

    const anyDivisionIsLarge =
      level === 0
        ? documentIsLarge
        : divisionsAtLevel(roots, level).some(
            (d) => d.end - d.start > LARGE_DIVISION_CHARS,
          );
    if (!documentIsLarge && !anyDivisionIsLarge) break;

    level += 1;
  }

  return level;
}

/** A ref-safe slug of a division's title, or `""`. */
export function titleSlug(title: string): string {
  return slugify(title);
}
