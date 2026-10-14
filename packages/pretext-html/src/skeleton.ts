/**
 * Prune a whole PreTeXt document down to the little of it a division preview
 * actually needs, so the stylesheets can number that division the way the
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
 *      counting divisions, so empty shells count exactly as full ones do;
 *   2. the blocks before it within its numbering scope — theorems are numbered
 *      within a section by default, so previewing subsection 3.2.4 needs the
 *      theorems of 3.2.1–3.2.3 to exist, though not their prose; and
 *   3. the division's own contents — which are present verbatim.
 *
 * So the skeleton never has to place a block at a chosen serial, and therefore
 * never has to know which elements share which counter — the part of PreTeXt's
 * numbering rules that would be a maintenance burden to mirror here and a
 * silent wrong-number bug when it drifted. Cross-reference targets elsewhere
 * are handled the same way: keep the target's numbering scope, minus its text,
 * and PreTeXt numbers the target itself.
 *
 * What is *not* kept matters as much. An earlier version of this kept a shell
 * of every division in the document, so the preview's table of contents would
 * be complete, and on a book of a thousand subsections those shells were 85%
 * of the render. Now shells are kept only down to the table of contents'
 * depth — the divisions the contents actually list — plus the siblings along
 * each anchored division's ancestry, which the numbering needs. On that book
 * the render drops from 1.5s to about a quarter of a second, most of it the
 * previewed division itself.
 *
 * The result is meant to be rendered with `subtree` set to
 * {@link Skeleton.divisionId} and `subtree-level` to {@link Skeleton.level},
 * which makes upstream emit only the previewed division. See
 * SUBTREE_CHUNK_LEVEL_OVERRIDE in scripts/refresh-xsl.mjs.
 */

import type { Element, ElementContent, Root, RootContent } from "xast";
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

/** Every structural element (`&STRUCTURAL;` in entities.ent). */
const STRUCTURAL = new Set([
  ...ROOT_DIVISIONS,
  ...LEVEL_DIVISIONS,
  "part",
  "foreword",
  "frontmatter",
  "backmatter",
]);

/**
 * True for a division upstream will accept as a `subtree` root — the
 * `&STRUCTURAL;` set, which is also what the skeleton keeps shells of.
 */
export function isStructural(element: Element): boolean {
  return STRUCTURAL.has(element.name);
}

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
  /**
   * Whether the division's own child divisions were reduced to title shells
   * (see {@link SkeletonOptions.collapseChildren}).
   */
  collapsed: boolean;
}

export interface SkeletonOptions {
  /**
   * Keep the previewed division's own content but reduce the divisions
   * nested inside it to shells — a heading each, no prose — the way a
   * chunked build's page for an intermediate division shows its introduction
   * and then only a summary of what is below. What makes previewing a
   * chapter's introduction cheap when the chapter itself is long.
   *
   * Cross-references from the kept content into a collapsed child still
   * resolve: the child holding the target is stripped of text rather than
   * emptied, exactly like any other target division.
   */
  collapseChildren?: boolean;
  /**
   * How deep the table of contents lists divisions (`tableofcontents/@level`
   * in the publication file). Shells of divisions are kept down to this
   * level everywhere in the document, so the preview's contents list is the
   * built book's; deeper divisions survive only where numbering needs them.
   * Defaults to PreTeXt's own default for the document's structure.
   */
  tocLevel?: number;
  /**
   * The level within which blocks — theorems, examples, figures, equations
   * and the rest — are numbered (the `numbering/*​/@level` family in the
   * publication file; the deepest of them, if they differ). Divisions deeper
   * than this that precede the previewed division within its scope are kept
   * with their text stripped, so the blocks in them are counted. Defaults to
   * PreTeXt's own default for the document's structure.
   */
  numberingLevel?: number;
  /**
   * The deepest level anything is numbered to (`numbering/divisions/@level`),
   * which caps `numberingLevel` and its default.
   */
  maxNumberingLevel?: number;
}

function isElement(node: RootContent | Element): node is Element {
  return node.type === "element";
}

function idOf(element: Element): string | undefined {
  return element.attributes["xml:id"] ?? undefined;
}

/** Depth-first search for the element carrying `@xml:id` equal to `id`. */
export function findById(
  node: Root | Element,
  id: string,
): Element | undefined {
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
export function pathTo(
  node: Root | Element,
  target: Element,
): Element[] | undefined {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child === target) return [child];
    const below = pathTo(child, target);
    if (below) return [child, ...below];
  }
  return undefined;
}

/**
 * The numbering level of an element whose parent sits at `parentLevel`,
 * mirroring `mode="level"` in pretext-numbers.xsl one step at a time.
 * `hasParts` is upstream's `$b-has-parts` (`boolean($root/book/part)`), which
 * pushes a book's chapters down a level.
 */
function stepLevel(
  parentLevel: number,
  parentName: string | undefined,
  name: string,
  hasParts: boolean,
): number {
  if (ROOT_DIVISIONS.has(name)) return 0;
  if (name === "frontmatter" || name === "backmatter" || name === "part") {
    // Level 0 in an article; in a book, 1 only when parts are in play.
    return parentName === "book" && hasParts ? 1 : 0;
  }
  if (LEVEL_DIVISIONS.has(name)) return parentLevel + 1;
  return parentLevel;
}

/**
 * A division's numbering level. `ancestors` runs from the document element
 * down to (and including) the division itself.
 */
export function divisionLevel(ancestors: Element[], hasParts: boolean): number {
  let level = 0;
  for (const [index, element] of ancestors.entries()) {
    const parent = index === 0 ? undefined : ancestors[index - 1];
    level = stepLevel(level, parent?.name, element.name, hasParts);
  }
  return level;
}

/** Whether a book is divided into parts (`$b-has-parts` upstream). */
function bookHasParts(documentElement: Element | undefined): boolean {
  return (
    documentElement?.name === "book" &&
    documentElement.children.some(
      (child) => isElement(child) && child.name === "part",
    )
  );
}

function hasChildNamed(element: Element, names: string[]): boolean {
  return element.children.some(
    (child) => isElement(child) && names.includes(child.name),
  );
}

/**
 * PreTeXt's default table-of-contents depth for a document, by its structure
 * — the `common/tableofcontents/pi:pub-attribute[@name='level']` default in
 * publisher-variables.xsl.
 */
export function defaultTocLevel(documentElement: Element | undefined): number {
  if (!documentElement) return 0;
  const name = documentElement.name;
  if (name === "book") {
    const parts = bookHasParts(documentElement);
    const chapters = parts
      ? documentElement.children.some(
          (child) =>
            isElement(child) &&
            child.name === "part" &&
            hasChildNamed(child, ["chapter"]),
        )
      : hasChildNamed(documentElement, ["chapter"]);
    const sections = (
      parts
        ? documentElement.children.flatMap((part) =>
            isElement(part) && part.name === "part" ? part.children : [],
          )
        : documentElement.children
    ).some(
      (chapter) =>
        isElement(chapter) &&
        chapter.name === "chapter" &&
        hasChildNamed(chapter, ["section"]),
    );
    if (parts && sections) return 3;
    if (parts && chapters) return 2;
    if (sections) return 2;
    if (chapters) return 1;
    return 0;
  }
  if (name === "article") {
    const sections = documentElement.children.filter(
      (child): child is Element => isElement(child) && child.name === "section",
    );
    if (sections.some((section) => hasChildNamed(section, ["subsection"]))) {
      return 2;
    }
    if (
      sections.length > 0 ||
      hasChildNamed(documentElement, ["worksheet", "handout"])
    ) {
      return 1;
    }
  }
  return 0;
}

/**
 * PreTeXt's default numbering level for blocks, projects, equations, figures
 * and footnotes, by the document's structure — `$default-numbering-level` in
 * publisher-variables.xsl.
 */
export function defaultNumberingLevel(
  documentElement: Element | undefined,
): number {
  if (!documentElement) return 0;
  if (documentElement.name === "book") {
    return bookHasParts(documentElement) ? 3 : 2;
  }
  if (
    documentElement.name === "article" &&
    hasChildNamed(documentElement, ["section", "worksheet", "handout"])
  ) {
    return 1;
  }
  return 0;
}

/** Strip every text node from a subtree, keeping titles and all elements. */
function stripText(element: Element): void {
  if (TITLE_ELEMENTS.has(element.name)) return;
  element.children = element.children.filter(isElement);
  for (const child of element.children) {
    stripText(child as Element);
  }
}

/** Strip text from every non-division child of `element`, titles excepted. */
function stripOwnContent(element: Element): void {
  for (const child of element.children) {
    if (isElement(child) && !STRUCTURAL.has(child.name)) {
      stripText(child);
    }
  }
}

/**
 * The `@ref` values every `<xref>` inside `element` points at. With
 * `skipDivisions`, divisions nested inside `element` are not searched — their
 * content is about to be collapsed away, so their references need no targets.
 */
function referencedIds(element: Element, skipDivisions = false): Set<string> {
  const refs = new Set<string>();
  const visit = (node: Element): void => {
    if (skipDivisions && node !== element && STRUCTURAL.has(node.name)) {
      return;
    }
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
 * What the prune has decided about the elements it will meet. Every set is
 * of elements of the one tree being pruned.
 */
interface Plan {
  /** Kept whole, recursion stops: the previewed division, target scopes. */
  verbatim: Set<Element>;
  /**
   * Ancestors-or-self of every anchor (the previewed division and each
   * cross-reference target's scope): recursed into, and their sibling
   * divisions kept as shells whatever their depth — the division numbering
   * counts them.
   */
  chain: Set<Element>;
  /** Elements whose own non-division content is kept. */
  contentKept: Set<Element>;
  /** Shells of divisions are kept everywhere down to this level. */
  tocLevel: number;
  hasParts: boolean;
}

/**
 * Prune `element` in place — a member of the chain, or a shell. Every
 * non-division child goes unless the element's content is kept; every
 * division child is kept whole (verbatim), recursed into (chain), kept as a
 * shell (a sibling on the chain, or within the contents depth), or dropped.
 */
function prune(element: Element, level: number, plan: Plan): void {
  const keepContent = plan.contentKept.has(element);
  const onChain = plan.chain.has(element);
  const kept: ElementContent[] = [];
  for (const child of element.children) {
    if (!isElement(child)) {
      if (keepContent) kept.push(child);
      continue;
    }
    if (
      plan.verbatim.has(child) ||
      VERBATIM.has(child.name) ||
      TITLE_ELEMENTS.has(child.name)
    ) {
      // Titles stay whole — their text is the heading, and the table of
      // contents and title-styled cross-reference text are built from it.
      kept.push(child);
    } else if (STRUCTURAL.has(child.name)) {
      const childLevel = stepLevel(
        level,
        element.name,
        child.name,
        plan.hasParts,
      );
      if (plan.chain.has(child) || onChain || childLevel <= plan.tocLevel) {
        prune(child, childLevel, plan);
        kept.push(child);
      }
      // Otherwise dropped: a division nested in a shell, below the contents
      // depth, that nothing on the page refers to.
    } else if (keepContent) {
      kept.push(child);
    }
  }
  element.children = kept;
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
  options: SkeletonOptions = {},
): Skeleton | undefined {
  const division = findById(tree, divisionId);
  if (!division) return undefined;
  const ancestors = pathTo(tree, division);
  if (!ancestors) return undefined;
  const collapse =
    (options.collapseChildren ?? false) &&
    division.children.some(
      (child) => isElement(child) && STRUCTURAL.has(child.name),
    );

  // <pretext> wraps the document element and is not itself a division.
  const isWrapper = (element: Element) =>
    element.name === "pretext" || element.name === "mathbook";
  const divisionPath = ancestors.filter((element) => !isWrapper(element));
  const documentElement = divisionPath[0];
  const hasParts = bookHasParts(documentElement);
  const level = divisionLevel(divisionPath, hasParts);
  const levelOf = (element: Element): number => {
    const chain = pathTo(tree, element)?.filter((e) => !isWrapper(e)) ?? [];
    return divisionLevel(chain, hasParts);
  };

  const maxNumbering = options.maxNumberingLevel ?? Infinity;
  const numberingLevel = Math.min(
    options.numberingLevel ?? defaultNumberingLevel(documentElement),
    maxNumbering,
  );
  const tocLevel = options.tocLevel ?? defaultTocLevel(documentElement);

  const plan: Plan = {
    verbatim: new Set(),
    chain: new Set(ancestors),
    contentKept: new Set(),
    tocLevel,
    hasParts,
  };
  // Kept whole for their blocks, then stripped of text.
  const stripWhole = new Set<Element>();
  // Ancestors of the previewed division whose own content holds a target:
  // that content is kept (and stripped), the division below it untouched.
  const stripOwn = new Set<Element>();

  if (collapse) {
    plan.contentKept.add(division);
  } else {
    plan.verbatim.add(division);
  }

  // Anchor a cross-reference target: keep the division it is numbered
  // within — the ancestor at the block-numbering level — whole and stripped,
  // so PreTeXt numbers the target itself, counting whatever precedes it.
  const anchorTarget = (target: Element): void => {
    const path = pathTo(tree, target);
    if (!path) return;
    const structural = path.filter((element) => STRUCTURAL.has(element.name));
    const nearest = structural[structural.length - 1];
    if (!nearest || nearest === division) return;
    if (ancestors.includes(nearest)) {
      // In an ancestor's own content (a chapter introduction, say).
      plan.contentKept.add(nearest);
      stripOwn.add(nearest);
      return;
    }
    // Climb to the numbering scope, but never past the previewed division's
    // own ancestry — a target below the division (collapsing) stays local.
    let scope = nearest;
    for (let i = structural.length - 1; i >= 0; i--) {
      if (levelOf(structural[i]) <= numberingLevel) break;
      if (ancestors.includes(structural[i - 1])) break;
      scope = structural[i - 1] ?? scope;
    }
    if (plan.verbatim.has(scope)) return;
    plan.verbatim.add(scope);
    stripWhole.add(scope);
    for (const element of pathTo(tree, scope) ?? []) plan.chain.add(element);
  };
  for (const ref of referencedIds(division, collapse)) {
    const target = findById(tree, ref);
    if (target && target !== division) anchorTarget(target);
  }

  // Blocks are numbered within the numbering scope, so the divisions that
  // precede an anchor inside its scope must keep their blocks: every
  // preceding sibling of each chain member deeper than the numbering level.
  for (const member of [...plan.chain]) {
    if (!STRUCTURAL.has(member.name) || levelOf(member) <= numberingLevel) {
      continue;
    }
    const parent = pathTo(tree, member)?.at(-2);
    if (!parent) continue;
    for (const sibling of parent.children) {
      if (sibling === member) break;
      if (!isElement(sibling) || !STRUCTURAL.has(sibling.name)) continue;
      if (plan.verbatim.has(sibling) || plan.chain.has(sibling)) continue;
      plan.verbatim.add(sibling);
      stripWhole.add(sibling);
    }
  }

  // Prune from the top down. The previewed division (when not collapsing)
  // and the target scopes are verbatim, so the recursion stops at them.
  const rootElement = tree.children.find(isElement);
  if (rootElement) {
    prune(rootElement, 0, plan);
  }
  for (const element of stripWhole) {
    stripText(element);
  }
  for (const element of stripOwn) {
    stripOwnContent(element);
  }

  return { content: toXml(tree), divisionId, level, collapsed: collapse };
}
