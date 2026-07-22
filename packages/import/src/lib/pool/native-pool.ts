// Builds the division pool (SPEC §4.1) directly from *native* source — cleaned
// but unconverted LaTeX or Markdown — so an author can host their project in
// pretext-plus without converting to PreTeXt. Divisions carry their native
// `sourceFormat`; hierarchy is expressed with the format's own placeholder
// syntax, matching what pretext-plus's editor parses (SPEC §4.1/§4.3):
//
//   latex:    parent has `\plus{chapter}{ref}`; a division opens with its
//             header macro, e.g. `\chapter{Title}\label{ref}` (the root uses
//             `\book{Title}\label{ref}` / `\article{…}`).
//   markdown: parent has `::chapter{ref="ref"}`; a division is YAML
//             frontmatter (`division:`/`id:`/`title:`) + a `# heading` body
//             (the root carries only the frontmatter + placeholders).
//
// docinfo and the document title are project-level in the plus data model and
// are the same regardless of the division source format, so they are hoisted
// in from the already-built PreTeXt pool rather than re-mined here.

import type { CleaningWarning } from "../clean/warnings";
import { splitLatexAtDocument } from "../clean/latex-preamble";
import type { DocumentKind } from "../layout/document-kind";
import { padIndex, slugify } from "../layout/shared";
import type { ImportedDivision } from "../types";
import type { BuildDivisionPoolResult } from "./division-pool";
import {
  buildAssets,
  claimRefFromId,
  pushRefWarnings,
  RefPool,
  sanitizeRef,
} from "./refs";

export interface BuildNativeDivisionPoolOptions {
  documentKind?: DocumentKind;
  splitChapters?: boolean;
  splitSections?: boolean;
  /** Project title, hoisted from the converted PreTeXt pool. */
  title?: string;
  /** Project `<docinfo>`, hoisted from the converted PreTeXt pool. */
  docinfo?: string;
  /** Binary assets keyed by their original (input) path. */
  assets?: Record<string, Uint8Array>;
}

/**
 * Build a native (LaTeX/Markdown) division pool from cleaned native source.
 * The result has the same shape as `buildDivisionPool`, so the same
 * serializers consume it — `serializeProjectToPlusPayload` in particular emits
 * `source_format: "latex" | "markdown"` divisions unchanged.
 */
export function buildNativeDivisionPool(
  nativeSource: string,
  format: "latex" | "markdown",
  options: BuildNativeDivisionPoolOptions = {},
): BuildDivisionPoolResult {
  return format === "latex"
    ? buildLatexDivisionPool(nativeSource, options)
    : buildMarkdownDivisionPool(nativeSource, options);
}

/** A ref-safe, lowercased slug of a division's title (empty if nothing valid). */
function slugRef(title: string): string {
  return sanitizeRef(slugify(title));
}

/**
 * Mint a division's ref: an explicit id (a `\label`) wins as-is when
 * REF_REGEX-safe and unused; otherwise a lowercased slug of the title;
 * otherwise a generated `<prefix>-NN`. Renames and generated ids are reported
 * as warnings. Unlike an explicit id, a title-derived slug is the expected
 * outcome, not a rename, so it is not warned about.
 */
function mintDivisionRef(
  explicitId: string | undefined,
  titleText: string,
  refs: RefPool,
  fallback: string,
  typeName: string,
  position: number,
  warnings: CleaningWarning[],
): string {
  if (explicitId) {
    const claim = claimRefFromId(
      explicitId,
      refs,
      slugRef(titleText) || fallback,
    );
    pushRefWarnings(warnings, claim, typeName, position);
    return claim.ref;
  }
  const fromTitle = slugRef(titleText);
  if (fromTitle) {
    return refs.claim(fromTitle);
  }
  const claim = claimRefFromId(undefined, refs, fallback);
  pushRefWarnings(warnings, claim, typeName, position);
  return claim.ref;
}

// ---------------------------------------------------------------------------
// LaTeX
// ---------------------------------------------------------------------------

/** Reduce a LaTeX title fragment to plain text for the division `title` field. */
function latexTitleToPlainText(tex: string): string {
  return tex
    .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, "$1") // \emph{x} → x
    .replace(/\\[a-zA-Z]+/g, "") // stray control words
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

/** Unescaped brace depth of `text` up to (not including) `index`. */
function braceDepthAt(text: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  return depth;
}

interface LatexDivision {
  /** Index in the source where `\chapter`/`\section` begins. */
  start: number;
  /** Raw (LaTeX) title, as it appeared in the header's braces. */
  rawTitle: string;
  /** Index just past the header (and any consumed `\label`). */
  contentStart: number;
  /** Ref from a `\label` immediately after the header, if any. */
  labelId?: string;
}

/**
 * Find top-level `\<cmd>{…}` divisions (chapters or sections) in `source`:
 * commands at brace depth 0, each with its title and an optional trailing
 * `\label`. Divisions partition the source between successive `start`s.
 */
function findTopLevelLatexDivisions(
  source: string,
  cmd: string,
): LatexDivision[] {
  const divisions: LatexDivision[] = [];
  const cmdRe = new RegExp(`\\\\${cmd}\\*?(?![a-zA-Z])`, "g");
  let m: RegExpExecArray | null;
  while ((m = cmdRe.exec(source)) !== null) {
    const start = m.index;
    if (braceDepthAt(source, start) !== 0) continue;
    const title = readBraceGroup(
      source,
      skipOptionalArg(source, start + m[0].length),
    );
    if (!title) continue;
    let contentStart = title.end;
    let labelId: string | undefined;
    const label = /^\s*\\label\s*\{([^{}]*)\}/.exec(source.slice(title.end));
    if (label) {
      labelId = label[1].trim();
      contentStart = title.end + label[0].length;
    }
    divisions.push({ start, rawTitle: title.inner, contentStart, labelId });
  }
  return divisions;
}

function buildLatexDivisionPool(
  nativeSource: string,
  options: BuildNativeDivisionPoolOptions,
): BuildDivisionPoolResult {
  const warnings: CleaningWarning[] = [];
  const { body } = splitLatexAtDocument(nativeSource);
  const source = (body || nativeSource).trim();

  const chapterMatches = findTopLevelLatexDivisions(source, "chapter");
  const documentKind: DocumentKind =
    options.documentKind ?? (chapterMatches.length > 0 ? "book" : "article");
  const splitChapters = options.splitChapters ?? documentKind === "book";
  const splitSections = options.splitSections ?? false;

  const refs = new RefPool();
  const rootRef = refs.claim("document");
  const divisions: ImportedDivision[] = [];

  let rootContent = source;

  if (splitChapters && documentKind === "book" && chapterMatches.length > 0) {
    const rootParts: string[] = [source.slice(0, chapterMatches[0].start)];

    chapterMatches.forEach((chapter, index) => {
      const end = chapterMatches[index + 1]?.start ?? source.length;
      const chapterTitle = latexTitleToPlainText(chapter.rawTitle);
      const ref = mintDivisionRef(
        chapter.labelId,
        chapterTitle,
        refs,
        `ch-${padIndex(index + 1, chapterMatches.length)}`,
        "chapter",
        index + 1,
        warnings,
      );

      let chapterInner = source.slice(chapter.contentStart, end);
      if (splitSections) {
        chapterInner = splitLatexSections(
          chapterInner,
          ref,
          refs,
          divisions,
          warnings,
        );
      }

      divisions.push({
        xmlId: ref,
        type: "chapter",
        title: chapterTitle,
        sourceFormat: "latex",
        content: `\\chapter{${chapter.rawTitle}}\\label{${ref}}\n${chapterInner.trim()}`,
        isRoot: false,
      });
      rootParts.push(`\\plus{chapter}{${ref}}`);
    });

    rootContent = rootParts.join("\n\n").trim();
  }

  // The root division opens with its own header macro (`\book`/`\article`),
  // mirroring how each chapter opens with `\chapter{…}\label{…}`.
  const rootType = documentKind === "book" ? "book" : "article";
  const rootTitle = options.title ?? "";
  const rootHeader = `\\${rootType}{${rootTitle}}\\label{${rootRef}}`;
  divisions.unshift({
    xmlId: rootRef,
    type: rootType,
    title: rootTitle,
    sourceFormat: "latex",
    content: rootContent ? `${rootHeader}\n${rootContent}` : rootHeader,
    isRoot: true,
  });

  return {
    project: {
      title: options.title ?? "",
      docinfo: options.docinfo ?? "",
      documentKind,
      divisions,
      assets: buildAssets(options.assets ?? {}, refs),
    },
    warnings,
  };
}

/**
 * Split a chapter's LaTeX body at top-level `\section`s, pushing a division per
 * section and returning the chapter body with each section replaced by a
 * `\plus{section}{ref}` placeholder.
 */
function splitLatexSections(
  chapterInner: string,
  chapterRef: string,
  refs: RefPool,
  divisions: ImportedDivision[],
  warnings: CleaningWarning[],
): string {
  const sectionMatches = findTopLevelLatexDivisions(chapterInner, "section");
  if (sectionMatches.length === 0) return chapterInner;

  const parts: string[] = [chapterInner.slice(0, sectionMatches[0].start)];
  sectionMatches.forEach((section, index) => {
    const end = sectionMatches[index + 1]?.start ?? chapterInner.length;
    const sectionTitle = latexTitleToPlainText(section.rawTitle);
    const ref = mintDivisionRef(
      section.labelId,
      sectionTitle,
      refs,
      `${chapterRef}-sec-${padIndex(index + 1, sectionMatches.length)}`,
      "section",
      index + 1,
      warnings,
    );
    const sectionInner = chapterInner.slice(section.contentStart, end).trim();
    divisions.push({
      xmlId: ref,
      type: "section",
      title: sectionTitle,
      sourceFormat: "latex",
      content: `\\section{${section.rawTitle}}\\label{${ref}}\n${sectionInner}`,
      isRoot: false,
    });
    parts.push(`\\plus{section}{${ref}}`);
  });
  return parts.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

interface MarkdownSection {
  headingText: string;
  body: string;
}

/**
 * Split Markdown `source` at ATX headings of exactly `level`, ignoring
 * headings inside fenced code blocks. Returns the text before the first such
 * heading and one entry per heading (its text + the body up to the next
 * heading of the same level).
 */
function splitAtHeadingLevel(
  source: string,
  level: number,
): { preamble: string; sections: MarkdownSection[] } {
  const headingRe = new RegExp(`^#{${level}}\\s+(.*)$`);
  const sections: { headingText: string; bodyLines: string[] }[] = [];
  const preambleLines: string[] = [];
  let current: { headingText: string; bodyLines: string[] } | null = null;
  let inFence = false;
  let fenceMarker = "";

  for (const line of source.split("\n")) {
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
      }
      (current ? current.bodyLines : preambleLines).push(line);
      continue;
    }
    const heading = inFence ? null : headingRe.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { headingText: heading[1].trim(), bodyLines: [] };
    } else {
      (current ? current.bodyLines : preambleLines).push(line);
    }
  }
  if (current) sections.push(current);

  return {
    preamble: preambleLines.join("\n").trim(),
    sections: sections.map((s) => ({
      headingText: s.headingText,
      body: s.bodyLines.join("\n").trim(),
    })),
  };
}

function markdownFrontmatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---`;
}

function buildMarkdownDivisionPool(
  nativeSource: string,
  options: BuildNativeDivisionPoolOptions,
): BuildDivisionPoolResult {
  const warnings: CleaningWarning[] = [];
  const source = nativeSource.trim();
  const documentKind: DocumentKind = options.documentKind ?? "article";
  const splitChapters = options.splitChapters ?? documentKind === "book";
  const splitSections = options.splitSections ?? false;

  const refs = new RefPool();
  const rootRef = refs.claim("document");
  const divisions: ImportedDivision[] = [];

  // Articles (and books when chapter-splitting is off) stay a single division,
  // mirroring the PreTeXt pool.
  if (!(splitChapters && documentKind === "book")) {
    divisions.push({
      xmlId: rootRef,
      type: documentKind === "book" ? "book" : "article",
      title: options.title ?? "",
      sourceFormat: "markdown",
      content: `${markdownFrontmatter({
        division: documentKind,
        id: rootRef,
        title: options.title ?? "",
      })}\n\n${source}`.trim(),
      isRoot: true,
    });
    return {
      project: {
        title: options.title ?? "",
        docinfo: options.docinfo ?? "",
        documentKind,
        divisions,
        assets: buildAssets(options.assets ?? {}, refs),
      },
      warnings,
    };
  }

  const { preamble, sections: chapters } = splitAtHeadingLevel(source, 1);
  const rootParts: string[] = preamble ? [preamble] : [];

  chapters.forEach((chapter, index) => {
    const ref = mintDivisionRef(
      undefined,
      chapter.headingText,
      refs,
      `ch-${padIndex(index + 1, chapters.length)}`,
      "chapter",
      index + 1,
      warnings,
    );

    let chapterBody = chapter.body;
    if (splitSections) {
      chapterBody = splitMarkdownSections(
        chapter.body,
        ref,
        refs,
        divisions,
        warnings,
      );
    }

    divisions.push({
      xmlId: ref,
      type: "chapter",
      title: chapter.headingText,
      sourceFormat: "markdown",
      content: `${markdownFrontmatter({
        division: "chapter",
        id: ref,
        title: chapter.headingText,
      })}\n\n# ${chapter.headingText}\n\n${chapterBody}`.trim(),
      isRoot: false,
    });
    rootParts.push(`::chapter{ref="${ref}"}`);
  });

  divisions.unshift({
    xmlId: rootRef,
    type: "book",
    title: options.title ?? "",
    sourceFormat: "markdown",
    content: `${markdownFrontmatter({
      division: "book",
      id: rootRef,
      title: options.title ?? "",
    })}\n\n${rootParts.join("\n\n")}`.trim(),
    isRoot: true,
  });

  return {
    project: {
      title: options.title ?? "",
      docinfo: options.docinfo ?? "",
      documentKind,
      divisions,
      assets: buildAssets(options.assets ?? {}, refs),
    },
    warnings,
  };
}

/**
 * Split a chapter's Markdown body at level-2 headings, pushing a section
 * division each and returning the chapter body with each section replaced by a
 * `::section{ref="…"}` placeholder. The division body re-emits its heading as a
 * top-level `# heading` (SPEC §4.1).
 */
function splitMarkdownSections(
  chapterBody: string,
  chapterRef: string,
  refs: RefPool,
  divisions: ImportedDivision[],
  warnings: CleaningWarning[],
): string {
  const { preamble, sections } = splitAtHeadingLevel(chapterBody, 2);
  if (sections.length === 0) return chapterBody;

  const parts: string[] = preamble ? [preamble] : [];
  sections.forEach((section, index) => {
    const ref = mintDivisionRef(
      undefined,
      section.headingText,
      refs,
      `${chapterRef}-sec-${padIndex(index + 1, sections.length)}`,
      "section",
      index + 1,
      warnings,
    );
    divisions.push({
      xmlId: ref,
      type: "section",
      title: section.headingText,
      sourceFormat: "markdown",
      content: `${markdownFrontmatter({
        division: "section",
        id: ref,
        title: section.headingText,
      })}\n\n# ${section.headingText}\n\n${section.body}`.trim(),
      isRoot: false,
    });
    parts.push(`::section{ref="${ref}"}`);
  });
  return parts.join("\n\n").trim();
}
