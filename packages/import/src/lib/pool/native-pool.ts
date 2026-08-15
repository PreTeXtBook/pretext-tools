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
import { filePrefixForDivision } from "../pretext-divisions";
import { resolveSplitLevel } from "./division-pool";
import {
  latexDivisionHierarchy,
  parseLatexDivisions,
  type LatexDivision,
} from "../latex-split";
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
  /**
   * How many levels of the document's own division hierarchy to split out —
   * the same number `buildDivisionPool` takes. Takes precedence over
   * `splitChapters`/`splitSections`.
   */
  splitLevel?: number;
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

function buildLatexDivisionPool(
  nativeSource: string,
  options: BuildNativeDivisionPoolOptions,
): BuildDivisionPoolResult {
  const warnings: CleaningWarning[] = [];
  const { body } = splitLatexAtDocument(nativeSource);
  const source = (body || nativeSource).trim();

  const roots = parseLatexDivisions(source);
  const hierarchy = latexDivisionHierarchy(source);
  const documentKind: DocumentKind =
    options.documentKind ??
    (hierarchy.includes("chapter") || hierarchy.includes("part")
      ? "book"
      : "article");
  const splitLevel = resolveSplitLevel(options, documentKind);

  const refs = new RefPool();
  const rootRef = refs.claim("document");
  const divisions: ImportedDivision[] = [];

  const rootContent = splitDivisions(source, roots, 0, source.length, 1, {
    maxDepth: splitLevel,
    refs,
    divisions,
    warnings,
    parentRef: rootRef,
  });

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

interface LatexSplitContext {
  /** Deepest level to extract; 0 extracts nothing. */
  maxDepth: number;
  refs: RefPool;
  divisions: ImportedDivision[];
  warnings: CleaningWarning[];
  parentRef: string;
}

/**
 * Return `source[from, to)` with each division in `nodes` lifted into the pool
 * and replaced by a `\plus{type}{ref}` placeholder, recursing until
 * `maxDepth`.
 *
 * This is the LaTeX twin of `splitChildDivisions` in `division-pool.ts`: one
 * depth parameter, any level of the document's own hierarchy, rather than the
 * chapter-then-section special case that came before.
 */
function splitDivisions(
  source: string,
  nodes: LatexDivision[],
  from: number,
  to: number,
  depth: number,
  context: LatexSplitContext,
): string {
  if (depth > context.maxDepth || nodes.length === 0) {
    return source.slice(from, to).trim();
  }

  const parts: string[] = [source.slice(from, nodes[0].start)];

  nodes.forEach((node, index) => {
    const prefix = filePrefixForDivision(node.command);
    // Top-level fallbacks read as `ch-01`; deeper ones are scoped by their
    // parent (`methods-sec-02`) so ids stay unique and self-describing.
    const numbered = `${prefix}-${padIndex(index + 1, nodes.length)}`;
    const fallback =
      depth === 1 ? numbered : `${context.parentRef}-${numbered}`;
    const ref = mintDivisionRef(
      node.labelId,
      node.title,
      context.refs,
      fallback,
      node.command,
      index + 1,
      context.warnings,
    );

    const inner = splitDivisions(
      source,
      node.children,
      node.contentStart,
      node.end,
      depth + 1,
      { ...context, parentRef: ref },
    );

    context.divisions.push({
      xmlId: ref,
      type: node.command as ImportedDivision["type"],
      title: node.title,
      sourceFormat: "latex",
      content: `\\${node.command}{${node.rawTitle}}\\label{${ref}}\n${inner}`,
      isRoot: false,
    });
    parts.push(`\\plus{${node.command}}{${ref}}`);
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
