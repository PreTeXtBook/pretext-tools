/**
 * Prune a whole PreTeXt document down to the little of it a fragment preview
 * actually needs, so the stylesheets can number that fragment the way the
 * built book will.
 *
 * The problem this solves. A fragment rendered on its own — the wrapper
 * `wrapFragment` builds in renderer.ts — restarts numbering at 1 and cannot
 * see any cross-reference target outside itself, so previewing section 3.2 of
 * a book shows "Theorem 1.1" where the book will say "Theorem 3.2.1", and
 * every `<xref>` leaving the section renders as PreTeXt's placeholder text,
 * `[cross-reference to target(s) "..." missing or not unique]`.
 *
 * Rendering the whole document instead fixes both, because PreTeXt computes
 * numbers positionally: `pretext-assembly.xsl` walks the source and stamps
 * `@pi:serial` and `@pi:block-struct` on every element. But it is far too slow
 * to do on every keystroke. That walk runs the tree through fourteen passes,
 * so its cost tracks the document's *node count* — measured at roughly 10s for
 * an 837KB book, and stripping text barely dents it (a text-only prune of that
 * book still took 9s).
 *
 * What actually makes it cheap is dropping *elements*, and the observation
 * that makes that safe is this: the numbering of everything inside the
 * previewed division depends only on
 *
 *   1. the divisions above and before it — because divisions are numbered by
 *      counting divisions, so empty shells count exactly as full ones do; and
 *   2. the division's own contents — which are present verbatim.
 *
 * So the skeleton never has to place a block at a chosen serial, and therefore
 * never has to know which elements share which counter — the part of PreTeXt's
 * numbering rules that would be a maintenance burden to mirror here and a
 * silent wrong-number bug when it drifted. Cross-reference targets elsewhere
 * are handled the same way: keep the target's whole division, minus its text,
 * and PreTeXt numbers the target itself.
 *
 * On the 837KB book above that is a skeleton of a few hundred nodes, and the
 * whole render — resolving the document's includes, pruning, and transforming
 * — drops from 10.4s to ~2.1s, with numbering and cross-reference text
 * identical to the full-document render, including a reference reaching twenty
 * chapters away. Most of what is left is the unavoidable cost of reading and
 * parsing the document itself.
 *
 * The result is meant to be rendered with `subtree` set to
 * {@link Skeleton.divisionId} and `subtree-level` to {@link Skeleton.level},
 * which makes upstream emit only the previewed division. See
 * SUBTREE_CHUNK_LEVEL_OVERRIDE in scripts/refresh-xsl.mjs.
 */

import type { Element, Root, RootContent } from "xast";
import { toXml } from "xast-util-to-xml";

/**
 * Divisions that occupy a numbering level: each is one deeper than its parent
 * (`mode="level"` in pretext-numbers.xsl). Note that `frontmatter` and
 * `backmatter` are absent — they are handled separately, being level 0 in an
 * article and level 0-or-1 in a book, never parent+1.
 */
const LEVEL_DIVISIONS = new Set([
  "colophon",
  "biography",
  "dedication",
  "acknowledgement",
  "preface",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "slide",
  "appendix",
  "index",
  "exercises",
  "reading-questions",
  "references",
  "solutions",
  "glossary",
  "worksheet",
  "handout",
]);

/** The document element, which sits at level 0. */
const ROOT_DIVISIONS = new Set([
  "book",
  "article",
  "slideshow",
  "letter",
  "memo",
]);

/**
 * Every structural element (`&STRUCTURAL;` in entities.ent). All of these are
 * kept, so the table of contents the preview draws lists the whole document
 * rather than only the branch being previewed.
 */
const STRUCTURAL = new Set([
  ...ROOT_DIVISIONS,
  ...LEVEL_DIVISIONS,
  "part",
  "frontmatter",
  "backmatter",
]);

/**
 * Kept verbatim, text and all. `<docinfo>` holds the LaTeX macros every `<m>`
 * in the previewed division expands against, plus the document's own settings;
 * shelling it out would break the fragment it is there to support.
 */
const VERBATIM = new Set(["docinfo"]);

/**
 * Elements whose text is kept when a subtree is stripped rather than dropped.
 * A cross-reference's text can be built from its target's title (`text="title"`
 * and the hybrid styles), and division titles are what the table of contents
 * and the page headings are made of.
 */
const TITLE_ELEMENTS = new Set([
  "title",
  "shorttitle",
  "plaintitle",
  "subtitle",
  "caption",
]);

/** A pruned document, ready to render as a fragment preview. */
export interface Skeleton {
  /** The pruned document, serialized. */
  content: string;
  /** `@xml:id` of the division to render; pass as the `subtree` param. */
  divisionId: string;
  /** That division's numbering level; pass as the `subtree-level` param. */
  level: number;
}

function isElement(node: RootContent | Element): node is Element {
  return node.type === "element";
}

function idOf(element: Element): string | undefined {
  return element.attributes["xml:id"] ?? undefined;
}

/** Depth-first search for the element carrying `@xml:id` equal to `id`. */
function findById(node: Root | Element, id: string): Element | undefined {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (idOf(child) === id) return child;
    const found = findById(child, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * The chain of elements from the document root down to `target`, inclusive.
 * Returns undefined when `target` is not in the tree.
 */
function pathTo(node: Root | Element, target: Element): Element[] | undefined {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child === target) return [child];
    const below = pathTo(child, target);
    if (below) return [child, ...below];
  }
  return undefined;
}

/**
 * A division's numbering level, mirroring `mode="level"` in
 * pretext-numbers.xsl. `ancestors` runs from the document element down to (and
 * including) the division itself.
 *
 * `hasParts` is upstream's `$b-has-parts` (`boolean($root/book/part)`), which
 * pushes a book's chapters down a level.
 */
export function divisionLevel(ancestors: Element[], hasParts: boolean): number {
  let level = 0;
  for (const [index, element] of ancestors.entries()) {
    const parent = index === 0 ? undefined : ancestors[index - 1];
    if (ROOT_DIVISIONS.has(element.name)) {
      level = 0;
    } else if (
      element.name === "frontmatter" ||
      element.name === "backmatter"
    ) {
      // Level 0 in an article; in a book, 1 only when parts are in play.
      level = parent?.name === "book" && hasParts ? 1 : 0;
    } else if (element.name === "part") {
      level = parent?.name === "book" && hasParts ? 1 : 0;
    } else if (LEVEL_DIVISIONS.has(element.name)) {
      level += 1;
    }
  }
  return level;
}

/** Strip every text node from a subtree, keeping titles and all elements. */
function stripText(element: Element): void {
  if (TITLE_ELEMENTS.has(element.name)) return;
  element.children = element.children.filter(isElement);
  for (const child of element.children) {
    stripText(child as Element);
  }
}

/**
 * Reduce `element` to a shell: its title (and any nested structure) survives,
 * everything else goes. `keep` names elements to recurse into rather than
 * discard — the previewed division's ancestors, and the divisions holding
 * cross-reference targets.
 */
function pruneToShell(element: Element, keep: Set<Element>): void {
  const kept: Element[] = [];
  for (const child of element.children) {
    if (!isElement(child)) continue;
    if (
      keep.has(child) ||
      VERBATIM.has(child.name) ||
      TITLE_ELEMENTS.has(child.name)
    ) {
      // Titles stay whole — their text is the heading, and the table of
      // contents and title-styled cross-reference text are built from it.
      kept.push(child);
    } else if (STRUCTURAL.has(child.name)) {
      // Divisions stay, emptied, so the table of contents stays complete.
      pruneToShell(child, keep);
      kept.push(child);
    }
  }
  element.children = kept;
}

/** The `@ref` values every `<xref>` inside `element` points at. */
function referencedIds(element: Element): Set<string> {
  const refs = new Set<string>();
  const visit = (node: Element): void => {
    if (node.name === "xref") {
      // @ref may be a space- or comma-separated list (a run of bibliography
      // citations); @first/@last is the two-ended form. Same normalization as
      // "error-check-xref" in pretext-common.xsl.
      const listed = [
        node.attributes["ref"],
        node.attributes["first"],
        node.attributes["last"],
      ];
      for (const value of listed) {
        for (const ref of value?.split(/[\s,]+/) ?? []) {
          if (ref) refs.add(ref);
        }
      }
    }
    for (const child of node.children) {
      if (isElement(child)) visit(child);
    }
  };
  visit(element);
  return refs;
}

/**
 * Swap the division carrying `id` for `replacement`, in place. Returns false
 * when the tree holds no such division.
 *
 * This is what lets a preview show *unsaved* work: the document on disk
 * supplies the structure around the fragment, while the fragment itself comes
 * from the editor's buffer.
 */
export function replaceDivision(
  tree: Root,
  id: string,
  replacement: Element,
): boolean {
  const visit = (parent: Root | Element): boolean => {
    for (const [index, child] of parent.children.entries()) {
      if (!isElement(child)) continue;
      if (idOf(child) === id) {
        parent.children[index] = replacement;
        return true;
      }
      if (visit(child)) return true;
    }
    return false;
  };
  return visit(tree);
}

/**
 * Build a skeleton of `tree` that preserves the numbering of the division
 * carrying `divisionId` and resolves the cross-references it makes.
 *
 * Prunes `tree` in place and serializes the result, so the caller can go on to
 * use the same tree — computing a source map from it, for instance, which is
 * what the renderer does.
 *
 * Returns undefined when the tree holds no such division — an unsaved file
 * whose `@xml:id` is not yet in the main document, say — which the caller
 * should treat as "fall back to the standalone fragment wrapper".
 */
export function buildSkeleton(
  tree: Root,
  divisionId: string,
): Skeleton | undefined {
  const division = findById(tree, divisionId);
  if (!division) return undefined;
  const ancestors = pathTo(tree, division);
  if (!ancestors) return undefined;

  // <pretext> wraps the document element and is not itself a division.
  const divisionPath = ancestors.filter(
    (element) => element.name !== "pretext" && element.name !== "mathbook",
  );
  const documentElement = divisionPath[0];
  const hasParts =
    documentElement?.name === "book" &&
    documentElement.children.some(
      (child) => isElement(child) && child.name === "part",
    );
  const level = divisionLevel(divisionPath, hasParts);

  // Everything that must survive the prune: the previewed division and each
  // of its ancestors, plus the division enclosing each cross-reference target.
  const keep = new Set<Element>(ancestors);
  const refs = referencedIds(division);
  const targetDivisions = new Set<Element>();
  if (refs.size > 0) {
    for (const ref of refs) {
      const target = findById(tree, ref);
      if (!target || target === division) continue;
      const path = pathTo(tree, target);
      if (!path) continue;
      // Walk out to the nearest enclosing division; keeping the whole division
      // means the target's preceding siblings are all present, which is what
      // gives the target its serial number.
      const enclosing = [...path]
        .reverse()
        .find((element) => STRUCTURAL.has(element.name));
      if (enclosing && enclosing !== division) {
        targetDivisions.add(enclosing);
        for (const element of pathTo(tree, enclosing) ?? []) {
          keep.add(element);
        }
      }
    }
  }

  for (const element of ancestors) {
    if (element === division) break;
    pruneToShell(element, keep);
  }
  // Target divisions keep every element (so nothing that carries a number is
  // lost) but no prose, which is the bulk of them.
  for (const element of targetDivisions) {
    stripText(element);
  }
  // The root of the tree itself, above <pretext>.
  const rootElement = tree.children.find(isElement);
  if (rootElement && !ancestors.includes(rootElement)) {
    pruneToShell(rootElement, keep);
  }

  return { content: toXml(tree), divisionId, level };
}
