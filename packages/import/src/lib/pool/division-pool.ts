// Builds the intermediate model of an imported project (SPEC §4.1): a flat
// pool of division records whose hierarchy is expressed by
// `<plus:TYPE ref="…"/>` placeholders inside parent content — the storage
// model of pretext-plus. The file-tree serializer (serialize-files.ts)
// projects the same pool onto a VS Code project folder.

import type { CleaningWarning } from "../clean/warnings";
import { detectDocumentKind, type DocumentKind } from "../layout/document-kind";
import { padIndex, spliceReplacements } from "../layout/shared";
import {
  findAnyElement,
  findFirstElement,
  findTopLevelElementsMatching,
  type XmlElementSpan,
} from "../layout/xml-scan";
import {
  filePrefixForDivision,
  isDivisionTag,
  type PretextDivisionTag,
} from "../pretext-divisions";
import type { ImportedDivision, ImportedProject } from "../types";
import {
  buildAssets,
  claimRefFromId,
  pushRefWarnings,
  RefPool,
  type ClaimRefResult,
} from "./refs";

// Re-exported for back-compat: callers (and the spec) import `sanitizeRef`
// from this module; the implementation now lives in `refs.ts`.
export { sanitizeRef } from "./refs";

export interface BuildDivisionPoolOptions {
  documentKind?: DocumentKind;
  /**
   * How many levels of division to split out of the root, e.g. 1 splits a
   * book's chapters (and its frontmatter/backmatter/appendices), 2 also splits
   * each chapter's sections, 0 keeps the whole document in one division.
   * Takes precedence over `splitChapters`/`splitSections`.
   */
  splitLevel?: number;
  splitChapters?: boolean;
  splitSections?: boolean;
  /** Binary assets keyed by their original (input) path. */
  assets?: Record<string, Uint8Array>;
}

/**
 * Reconcile the split options into a single depth. `splitChapters` and
 * `splitSections` predate `splitLevel` and stay supported, but they mean
 * different depths in a book (chapters at 1, sections at 2) than in an article
 * (sections at 1), so they are resolved against the document kind.
 */
export function resolveSplitLevel(
  options: BuildDivisionPoolOptions,
  documentKind: DocumentKind,
): number {
  if (options.splitLevel !== undefined) {
    return Math.max(0, options.splitLevel);
  }
  if (options.splitChapters === false) {
    return 0;
  }
  if (options.splitSections) {
    return documentKind === "book" ? 2 : 1;
  }
  return documentKind === "book" ? 1 : 0;
}

export interface BuildDivisionPoolResult {
  project: ImportedProject;
  warnings: CleaningWarning[];
}

/**
 * Return `outer` (a complete element string) with `xml:id` set to `xmlId` on
 * its opening tag — replacing an existing `xml:id` or inserting one after the
 * tag name. `startTagLength` is the length of the opening tag within `outer`.
 */
function withXmlId(
  outer: string,
  startTagLength: number,
  xmlId: string,
): string {
  const openTag = outer.slice(0, startTagLength);
  const rest = outer.slice(startTagLength);
  if (/\bxml:id\s*=\s*(?:"[^"]*"|'[^']*')/.test(openTag)) {
    return (
      openTag.replace(
        /\bxml:id\s*=\s*(?:"[^"]*"|'[^']*')/,
        `xml:id="${xmlId}"`,
      ) + rest
    );
  }
  return (
    openTag.replace(/^<([a-zA-Z_:][\w:.-]*)/, `<$1 xml:id="${xmlId}"`) + rest
  );
}

/** Extract an element's `<title>` as plain text (nested markup stripped). */
function extractTitleText(inner: string): string {
  const titleSpan = findFirstElement(inner, "title");
  if (!titleSpan) return "";
  return titleSpan.inner
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Decide a division's ref from its element span: its existing `xml:id` when
 * REF_REGEX-safe and unused, a sanitized/deduplicated variant when not
 * (reported as a rename), or a generated `<prefix>-NN` when it has no id.
 */
function claimRef(
  span: XmlElementSpan,
  refs: RefPool,
  fallback: string,
): ClaimRefResult {
  return claimRefFromId(span.attributes["xml:id"], refs, fallback);
}

/** Rebuild an element's outer string from its span with new inner content. */
function rebuildOuter(span: XmlElementSpan, newInner: string): string {
  const openTag = span.outer.slice(0, span.startTagEnd - span.start);
  const closeTag = span.outer.slice(span.contentEnd - span.start);
  return openTag + newInner + closeTag;
}

interface SplitContext {
  refs: RefPool;
  divisions: ImportedDivision[];
  warnings: CleaningWarning[];
  /** Deepest level of division to extract; 0 extracts nothing. */
  maxDepth: number;
}

/**
 * Split a division's content at each of its direct-child divisions, recursing
 * until `maxDepth`. Returns the parent's content with every extracted child
 * replaced by a `<plus:TYPE ref="…"/>` placeholder; the children themselves
 * are appended to the (flat) pool.
 *
 * Any tag in the PreTeXt division vocabulary is a split point, so a book's
 * frontmatter, parts, appendices, and worksheets travel the same path as its
 * chapters — which is what an existing project imported from `project.ptx`
 * actually contains.
 */
function splitChildDivisions(
  inner: string,
  parentRef: string,
  depth: number,
  context: SplitContext,
): string {
  if (depth > context.maxDepth) {
    return inner;
  }
  const childSpans = findTopLevelElementsMatching(inner, isDivisionTag);
  if (childSpans.length === 0) {
    return inner;
  }

  const replacements = childSpans.map((span, index) => {
    const position = index + 1;
    const prefix = filePrefixForDivision(span.name);
    const numbered = `${prefix}-${padIndex(position, childSpans.length)}`;
    // Top-level fallbacks read as `ch-01`; deeper ones are scoped by their
    // parent (`methods-sec-02`) so ids stay unique and self-describing.
    const fallback = depth === 1 ? numbered : `${parentRef}-${numbered}`;
    const claim = claimRef(span, context.refs, fallback);
    pushRefWarnings(context.warnings, claim, span.name, position);

    const childInner = splitChildDivisions(
      span.inner,
      claim.ref,
      depth + 1,
      context,
    );

    context.divisions.push({
      xmlId: claim.ref,
      type: span.name as PretextDivisionTag,
      title: extractTitleText(span.inner),
      sourceFormat: "pretext",
      content: withXmlId(
        rebuildOuter(span, childInner),
        span.startTagEnd - span.start,
        claim.ref,
      ),
      isRoot: false,
    });

    return {
      start: span.start,
      end: span.end,
      replacement: `<plus:${span.name} ref="${claim.ref}"/>`,
    };
  });

  return spliceReplacements(inner, replacements);
}

/**
 * Parse a converted PreTeXt document
 * (`<pretext><docinfo>…</docinfo><book|article>…`) into the division pool.
 *
 * - `docinfo` and the document `<title>` become project-level fields (the
 *   plus data model); the file-tree serializer re-inlines them.
 * - Divisions are split out to `splitLevel` levels deep (default: 1 for a
 *   book, 0 for an article), each replaced in its parent by a
 *   `<plus:TYPE ref="…"/>` placeholder.
 * - Every division's wrapper element carries `xml:id` equal to its ref;
 *   missing ids are generated (`ch-01`, …), invalid/duplicate ids are
 *   sanitized with a warning.
 */
export function buildDivisionPool(
  pretextSource: string,
  options: BuildDivisionPoolOptions = {},
): BuildDivisionPoolResult {
  const warnings: CleaningWarning[] = [];
  const documentKind: DocumentKind =
    options.documentKind ?? detectDocumentKind(pretextSource);
  const splitLevel = resolveSplitLevel(options, documentKind);

  const pretextSpan = findAnyElement(pretextSource, "pretext");
  const scope = pretextSpan ? pretextSpan.inner : pretextSource;

  const docinfoSpan = findFirstElement(scope, "docinfo");
  const docinfo = docinfoSpan?.outer.trim() ?? "";

  let rootSpan =
    findFirstElement(scope, "book") ?? findFirstElement(scope, "article");
  if (!rootSpan) {
    // No explicit root element (e.g. a bare fragment): wrap the content —
    // minus any top-level docinfo — in a root chosen from the document kind.
    const wrapperTag = documentKind === "book" ? "book" : "article";
    const body = (
      docinfoSpan
        ? scope.slice(0, docinfoSpan.start) + scope.slice(docinfoSpan.end)
        : scope
    ).trim();
    rootSpan = findFirstElement(
      `<${wrapperTag}>\n${body}\n</${wrapperTag}>`,
      wrapperTag,
    );
  }
  if (!rootSpan) {
    // Unreachable (we just built the wrapper), but keeps types honest.
    throw new Error("Could not locate a root element for the division pool.");
  }

  if (documentKind === "book" && rootSpan.name !== "book") {
    warnings.push({
      action: "anomaly",
      severity: "warning",
      kind: "structure",
      category: "missing_root",
      macro: "book",
      occurrences: 1,
      message:
        "Document was treated as a book but no <book> element found; importing with the existing root.",
    });
  }

  const refs = new RefPool();
  const divisions: ImportedDivision[] = [];

  const rootClaim = claimRef(rootSpan, refs, "document");
  // A missing root xml:id is the normal case for converted documents (the
  // default ref "document" matches pretext-plus's own default), so only a
  // rename is worth surfacing.
  if (rootClaim.renamedFrom !== undefined) {
    pushRefWarnings(warnings, rootClaim, rootSpan.name, 1);
  }
  const title = extractTitleText(rootSpan.inner);

  const rootInner = splitChildDivisions(rootSpan.inner, rootClaim.ref, 1, {
    refs,
    divisions,
    warnings,
    maxDepth: splitLevel,
  });

  const rootDivision: ImportedDivision = {
    xmlId: rootClaim.ref,
    type: rootSpan.name === "book" ? "book" : "article",
    title,
    sourceFormat: "pretext",
    content: withXmlId(
      rebuildOuter(rootSpan, rootInner),
      rootSpan.startTagEnd - rootSpan.start,
      rootClaim.ref,
    ),
    isRoot: true,
  };
  divisions.unshift(rootDivision);

  const assets = buildAssets(options.assets ?? {}, refs);

  return {
    project: {
      title,
      docinfo,
      documentKind,
      divisions,
      assets,
    },
    warnings,
  };
}
