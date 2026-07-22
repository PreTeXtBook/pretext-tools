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
  findTopLevelElements,
  type XmlElementSpan,
} from "../layout/xml-scan";
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
  splitChapters?: boolean;
  splitSections?: boolean;
  /** Binary assets keyed by their original (input) path. */
  assets?: Record<string, Uint8Array>;
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

/**
 * Parse a converted PreTeXt document
 * (`<pretext><docinfo>…</docinfo><book|article>…`) into the division pool.
 *
 * - `docinfo` and the document `<title>` become project-level fields (the
 *   plus data model); the file-tree serializer re-inlines them.
 * - With `splitChapters` (default for books), each `<chapter>` becomes its
 *   own division, replaced in the root by `<plus:chapter ref="…"/>`;
 *   `splitSections` does the same for `<section>`s within each chapter.
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
  const splitChapters = options.splitChapters ?? documentKind === "book";
  const splitSections = options.splitSections ?? false;

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

  let rootInner = rootSpan.inner;

  if (splitChapters && documentKind === "book") {
    const chapterSpans = findTopLevelElements(rootSpan.inner, "chapter");
    const replacements = chapterSpans.map((chapterSpan, index) => {
      const claim = claimRef(
        chapterSpan,
        refs,
        `ch-${padIndex(index + 1, chapterSpans.length)}`,
      );
      pushRefWarnings(warnings, claim, "chapter", index + 1);

      let chapterInner = chapterSpan.inner;
      if (splitSections) {
        const sectionSpans = findTopLevelElements(chapterSpan.inner, "section");
        const sectionReplacements = sectionSpans.map((sectionSpan, sIndex) => {
          const sectionClaim = claimRef(
            sectionSpan,
            refs,
            `${claim.ref}-sec-${padIndex(sIndex + 1, sectionSpans.length)}`,
          );
          pushRefWarnings(warnings, sectionClaim, "section", sIndex + 1);
          divisions.push({
            xmlId: sectionClaim.ref,
            type: "section",
            title: extractTitleText(sectionSpan.inner),
            sourceFormat: "pretext",
            content: withXmlId(
              sectionSpan.outer,
              sectionSpan.startTagEnd - sectionSpan.start,
              sectionClaim.ref,
            ),
            isRoot: false,
          });
          return {
            start: sectionSpan.start,
            end: sectionSpan.end,
            replacement: `<plus:section ref="${sectionClaim.ref}"/>`,
          };
        });
        chapterInner = spliceReplacements(
          chapterSpan.inner,
          sectionReplacements,
        );
      }

      divisions.push({
        xmlId: claim.ref,
        type: "chapter",
        title: extractTitleText(chapterSpan.inner),
        sourceFormat: "pretext",
        content: withXmlId(
          rebuildOuter(chapterSpan, chapterInner),
          chapterSpan.startTagEnd - chapterSpan.start,
          claim.ref,
        ),
        isRoot: false,
      });
      return {
        start: chapterSpan.start,
        end: chapterSpan.end,
        replacement: `<plus:chapter ref="${claim.ref}"/>`,
      };
    });
    rootInner = spliceReplacements(rootSpan.inner, replacements);
  }

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
