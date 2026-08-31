// Choosing which divisions of a document to import (SPEC §9, step 6).
//
// The pipeline has always taken a document whole. Pulling three quizzes out of
// a semester's worth of them is the one thing it could not do: `attachRoots`
// (§3.12) selects among *roots*, not among the divisions inside one.
//
// Selection is a prune of the converted source, before anything else looks at
// it. That placement is the whole design. Pruning the division *pool* instead
// would tie what an author may select to `splitLevel` — you could only pick
// divisions the splitter happened to lift into files — and would leave the
// retarget measuring a document that is no longer the one being imported.

import {
  elementTitleText,
  findFirstElement,
  findTopLevelElementsMatching,
} from "../layout/xml-scan";
import { spliceReplacements } from "../layout/shared";
import { isDivisionTag } from "../pretext-divisions";

/**
 * A division's address within a document: its index among its siblings, joined
 * by dots (`"2"`, `"2.0"`).
 *
 * Positional rather than by `xml:id` because most converted documents have no
 * ids yet — the pool mints them downstream — and an address that only works for
 * documents that were already well-labelled would be no use on exactly the
 * imports that need it. Stable for a given source, which is all a selection has
 * to outlive.
 */
export type DivisionPath = string;

export interface DivisionOutlineItem {
  path: DivisionPath;
  /** Element name (`section`, `exercises`, …). */
  tag: string;
  /** The division's own `<title>`, or `""`. */
  title: string;
  /** Its `xml:id`, when the source already carried one. */
  xmlId?: string;
  children: DivisionOutlineItem[];
}

/** Locate the document root's inner content, mirroring `buildDivisionPool`. */
function rootInner(pretextSource: string): string {
  const pretextSpan = findFirstElement(pretextSource, "pretext");
  const scope = pretextSpan ? pretextSpan.inner : pretextSource;
  const root =
    findFirstElement(scope, "book") ?? findFirstElement(scope, "article");
  return root ? root.inner : scope;
}

/**
 * The document's divisions as a tree, addressed by `DivisionPath` — what a host
 * renders its picker from.
 */
export function outlineDivisions(pretextSource: string): DivisionOutlineItem[] {
  function walk(inner: string, prefix: string): DivisionOutlineItem[] {
    return findTopLevelElementsMatching(inner, isDivisionTag).map(
      (span, index) => {
        const path = prefix ? `${prefix}.${index}` : String(index);
        return {
          path,
          tag: span.name,
          title: elementTitleText(span.inner),
          xmlId: span.attributes["xml:id"],
          children: walk(span.inner, path),
        };
      },
    );
  }
  return walk(rootInner(pretextSource), "");
}

/** Is `path` at, above, or below one of the selected paths? */
function isKept(path: DivisionPath, selected: ReadonlySet<string>): boolean {
  if (selected.has(path)) {
    return true;
  }
  for (const pick of selected) {
    // An ancestor of a pick is structure the pick needs; a descendant of a pick
    // travels with it. `"1"` is an ancestor of `"1.2"` but not of `"10"`, hence
    // the separator in the test.
    if (pick.startsWith(`${path}.`) || path.startsWith(`${pick}.`)) {
      return true;
    }
  }
  return false;
}

export interface PruneDivisionsResult {
  source: string;
  /** Paths of the divisions removed, in document order. */
  removed: DivisionPath[];
}

/**
 * Remove every division the selection does not reach.
 *
 * A selected division comes whole — its own subdivisions travel with it — and
 * the divisions containing it are kept as the structure it hangs from. Content
 * that belongs to a kept division but to none of its subdivisions (a chapter's
 * introductory prose, say) stays: it is the parent's own, and dropping it would
 * lose material the author never deselected.
 *
 * An empty or absent selection expresses no narrowing, so nothing is pruned —
 * a host that wants "import nothing" should not run an import.
 */
export function pruneDivisions(
  pretextSource: string,
  selection: readonly DivisionPath[] | undefined,
): PruneDivisionsResult {
  if (!selection || selection.length === 0) {
    return { source: pretextSource, removed: [] };
  }
  const selected = new Set(selection);
  const removed: DivisionPath[] = [];

  function prune(
    inner: string,
    prefix: string,
    offset: number,
  ): Array<{
    start: number;
    end: number;
    replacement: string;
  }> {
    const replacements: Array<{
      start: number;
      end: number;
      replacement: string;
    }> = [];
    findTopLevelElementsMatching(inner, isDivisionTag).forEach(
      (span, index) => {
        const path = prefix ? `${prefix}.${index}` : String(index);
        if (!isKept(path, selected)) {
          removed.push(path);
          replacements.push({
            start: offset + span.start,
            end: offset + span.end,
            replacement: "",
          });
          return;
        }
        // A kept division that is not itself selected is being kept as structure,
        // so its own children still have to be filtered. One that *is* selected
        // comes whole, and its children are not examined at all.
        if (!selected.has(path)) {
          replacements.push(
            ...prune(span.inner, path, offset + span.startTagEnd),
          );
        }
      },
    );
    return replacements;
  }

  const pretextSpan = findFirstElement(pretextSource, "pretext");
  const scope = pretextSpan ? pretextSpan.inner : pretextSource;
  const scopeOffset = pretextSpan ? pretextSpan.startTagEnd : 0;
  const root =
    findFirstElement(scope, "book") ?? findFirstElement(scope, "article");
  const innerOffset = scopeOffset + (root ? root.startTagEnd : 0);
  const inner = root ? root.inner : scope;

  return {
    source: spliceReplacements(pretextSource, prune(inner, "", innerOffset)),
    removed,
  };
}
