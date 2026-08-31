// The pre-pool half of an insert (SPEC §9.2): everything that has to happen to
// a converted document *before* `buildDivisionPool` splits it.
//
// Both transforms have to run here rather than at serialization time. A
// reference can only follow a rename while the `xml:id` declaring it sits in
// the same string, and once the pool has split the document a parent holding
// `<plus:subsection ref="…"/>` can no longer see what it names. Retargeting
// first is what makes the overflow rule and the splitter agree: `<paragraphs>`
// is in place before the splitter goes looking for divisions to lift out, and
// `<paragraphs>` is not a division, so overflow content can never become a file.

import type { CleaningWarning } from "../clean/warnings";
import { slugify, spliceReplacements } from "../layout/shared";
import {
  findFirstElement,
  findTopLevelElementsMatching,
  type XmlElementSpan,
} from "../layout/xml-scan";
import { sanitizeRef } from "../pool/refs";
import { isDivisionTag, ladderDepth } from "../pretext-divisions";
import { dedupeXmlIds, type XmlIdRename } from "./dedupe-ids";
import {
  retargetFragmentToDepth,
  type RetargetFragmentResult,
} from "./retarget";
import type { InsertDestination } from "./destination";

export interface PreparedInsertSource {
  /** The document to hand to `buildDivisionPool`, retargeted and deduped. */
  source: string;
  /**
   * True when the document's `<book>`/`<article>` wrapper is scaffolding the
   * import should discard, its children being the units actually inserted.
   * False when the wrapper carries a title of its own and becomes the
   * inserted division. The serializer reads this; the pool never sees it.
   */
  unwrapRoot: boolean;
  retarget: RetargetFragmentResult;
  renamed: XmlIdRename[];
  warnings: CleaningWarning[];
}

/**
 * Should the document wrapper be dropped in favour of its children?
 *
 * A converted document always has a `<book>`/`<article>` wrapper, but whether
 * that wrapper *means* anything depends on the source. A LaTeX file that is one
 * `\section{Homework 3}` converts to a wrapper around a single titled division:
 * the wrapper is an artifact of conversion, and keeping it would insert an
 * empty, untitled level above the homework. A file with `\title{Homework 3}`
 * and prose beneath it converts to a wrapper that carries the title itself, and
 * dropping it would throw that title away.
 *
 * The `<title>` is what separates the two, so it is what the rule keys on: a
 * wrapper with a title of its own survives as a division; a titleless wrapper
 * whose children are all divisions is scaffolding. (A titleless wrapper holding
 * loose prose is neither — there is nothing to unwrap *to* — so it survives and
 * is reported as needing a title.)
 */
function shouldUnwrapRoot(rootInner: string): boolean {
  if (findFirstElement(rootInner, "title")) {
    return false;
  }
  const topLevel = findTopLevelElementsMatching(rootInner, () => true);
  if (topLevel.length === 0) {
    return false;
  }
  if (!topLevel.every((span) => isDivisionTag(span.name))) {
    return false;
  }
  // Stray prose would have nowhere to go once the wrapper is gone.
  return !rootHasLooseContent(rootInner);
}

/**
 * Does the wrapper hold anything of its own — a title, or prose outside every
 * division? That is what unwrapping would throw away.
 */
function rootHasLooseContent(rootInner: string): boolean {
  const spans = findTopLevelElementsMatching(rootInner, isDivisionTag);
  let between = "";
  let cursor = 0;
  for (const span of spans) {
    between += rootInner.slice(cursor, span.start);
    cursor = span.end;
  }
  between += rootInner.slice(cursor);
  return between.replace(/<!--[\s\S]*?-->/g, "").trim() !== "";
}

/**
 * Locate the document root element, mirroring `buildDivisionPool`. Offsets are
 * returned relative to `pretextSource`, so the span can be edited in place.
 */
function findRoot(pretextSource: string): XmlElementSpan | null {
  const pretextSpan = findFirstElement(pretextSource, "pretext");
  const scope = pretextSpan ? pretextSpan.inner : pretextSource;
  const offset = pretextSpan ? pretextSpan.startTagEnd : 0;
  const root =
    findFirstElement(scope, "book") ?? findFirstElement(scope, "article");
  if (!root) return null;
  return {
    ...root,
    start: root.start + offset,
    startTagEnd: root.startTagEnd + offset,
    contentEnd: root.contentEnd + offset,
    end: root.end + offset,
  };
}

/** Extract an element's `<title>` as plain text (nested markup stripped). */
function titleTextOf(inner: string): string {
  const titleSpan = findFirstElement(inner, "title");
  if (!titleSpan) return "";
  return titleSpan.inner
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Name the divisions actually being inserted after their titles, when they
 * have no `xml:id` of their own.
 *
 * Left alone, `buildDivisionPool` mints positional fallbacks — `document` for
 * a root, `subsec-01` for a child. Those read fine in a project the import
 * created, where they are the only ids there are, and badly in someone else's
 * project, where they become both a visible id and a filename
 * (`subsec-01.ptx`) that says nothing about what it holds. The title is what
 * an author would have named it.
 *
 * Only the top-level units get this treatment. Deeper divisions keep the
 * pool's fallbacks, which are already scoped by their parent
 * (`homework-3-subsubsec-01`) and so are neither ambiguous nor unstable.
 */
function ensureUnitXmlIds(
  pretextSource: string,
  units: XmlElementSpan[],
  takenIds: ReadonlySet<string>,
): string {
  const assigned = new Set<string>(takenIds);
  const replacements: Array<{
    start: number;
    end: number;
    replacement: string;
  }> = [];

  for (const unit of units) {
    const existing = unit.attributes["xml:id"];
    if (existing) {
      assigned.add(existing);
      continue;
    }

    const base = sanitizeRef(slugify(titleTextOf(unit.inner))) || "imported";
    let id = base;
    let n = 2;
    while (assigned.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    assigned.add(id);

    replacements.push({
      start: unit.start,
      end: unit.startTagEnd,
      replacement: pretextSource
        .slice(unit.start, unit.startTagEnd)
        .replace(/^<([a-zA-Z_:][\w:.-]*)/, `<$1 xml:id="${id}"`),
    });
  }

  return replacements.length === 0
    ? pretextSource
    : spliceReplacements(pretextSource, replacements);
}

/**
 * The divisions the host actually receives: the wrapper itself when it
 * survives, or its top-level division children when it is dropped. Spans are
 * rebased onto `pretextSource` so they can be edited in place.
 */
function insertUnits(
  root: XmlElementSpan,
  unwrapRoot: boolean,
): XmlElementSpan[] {
  if (!unwrapRoot) return [root];
  return findTopLevelElementsMatching(root.inner, isDivisionTag).map(
    (span) => ({
      ...span,
      start: span.start + root.startTagEnd,
      startTagEnd: span.startTagEnd + root.startTagEnd,
      contentEnd: span.contentEnd + root.startTagEnd,
      end: span.end + root.startTagEnd,
    }),
  );
}

/**
 * The shallowest split an insert can be laid out at.
 *
 * Dropping the wrapper makes the root's children the units being inserted, and
 * a unit with no file of its own is a unit that never arrives: at level 0 the
 * pool holds nothing but the root, and the root is exactly what was dropped.
 * So unwrapping forces one level of split, whatever the split dial says.
 */
export function minimumInsertSplitLevel(unwrapRoot: boolean): number {
  return unwrapRoot ? 1 : 0;
}

/**
 * Retarget and de-collide a converted document so it can join a host project.
 *
 * The result's `source` is still a whole document — the pool builder is left
 * exactly as it is, and `unwrapRoot` tells the serializer what to do with the
 * root division it produces.
 */
export interface PrepareInsertOptions {
  /**
   * True when the author cherry-picked divisions (SPEC §9, step 6), which
   * forces the unwrap: once they have named the divisions they want, the
   * wrapper is no longer the document but the container they picked *from*, and
   * keeping it would insert a level nobody asked for.
   */
  hasSelection?: boolean;
}

export function prepareInsertSource(
  pretextSource: string,
  destination: InsertDestination,
  options: PrepareInsertOptions = {},
): PreparedInsertSource {
  const warnings: CleaningWarning[] = [];
  const root = findRoot(pretextSource);
  const rootInner = root?.inner ?? null;
  const naturalUnwrap = rootInner !== null && shouldUnwrapRoot(rootInner);
  const unwrapRoot =
    rootInner !== null && (options.hasSelection || naturalUnwrap);

  if (
    unwrapRoot &&
    !naturalUnwrap &&
    rootInner !== null &&
    rootHasLooseContent(rootInner)
  ) {
    warnings.push({
      action: "delete",
      severity: "warning",
      kind: "structure",
      category: "dropped_wrapper_content",
      macro: "article",
      occurrences: 1,
      message:
        "The selected divisions are inserted on their own, so the document's title and any text outside them are not carried across.",
    });
  }

  const named = root
    ? ensureUnitXmlIds(
        pretextSource,
        insertUnits(root, unwrapRoot),
        destination.takenIds,
      )
    : pretextSource;

  const targetDepth = ladderDepth(destination.targetTag);
  // When the wrapper survives it becomes the target level itself, so the
  // divisions inside it belong one rung below. When it is dropped, its
  // children *are* the target level.
  const retarget = retargetFragmentToDepth(
    named,
    targetDepth < 0 ? -1 : unwrapRoot ? targetDepth : targetDepth + 1,
  );

  const { source, renamed } = dedupeXmlIds(retarget.source, {
    takenIds: destination.takenIds,
  });

  if (retarget.overflowed.length > 0) {
    warnings.push({
      action: "anomaly",
      severity: "warning",
      kind: "structure",
      category: "division_overflow",
      macro: destination.targetTag,
      occurrences: retarget.overflowed.length,
      message: `Inserting at <${destination.targetTag}> pushes ${retarget.overflowed
        .map((tag) => `<${tag}>`)
        .join(", ")} past <subsubsection>; ${
        retarget.overflowed.length === 1 ? "it becomes" : "they become"
      } <paragraphs>, which stays inline rather than becoming its own file.`,
    });
  }

  if (renamed.length > 0) {
    warnings.push({
      action: "anomaly",
      severity: "warning",
      kind: "structure",
      category: "renamed_xml_id",
      macro: "xml:id",
      occurrences: renamed.length,
      message: `${renamed.length} imported id${
        renamed.length === 1 ? "" : "s"
      } already existed in this project and ${
        renamed.length === 1 ? "was" : "were"
      } renamed: ${renamed.map((r) => `\`${r.from}\` → \`${r.to}\``).join(", ")}.`,
    });
  }

  if (
    !unwrapRoot &&
    rootInner !== null &&
    !findFirstElement(rootInner, "title")
  ) {
    warnings.push({
      action: "anomaly",
      severity: "warning",
      kind: "structure",
      category: "missing_title",
      macro: destination.targetTag,
      occurrences: 1,
      message: `The imported document has no title, so the <${destination.targetTag}> it becomes has none either. PreTeXt divisions need a title; add one before building.`,
    });
  }

  return { source, unwrapRoot, retarget, renamed, warnings };
}
