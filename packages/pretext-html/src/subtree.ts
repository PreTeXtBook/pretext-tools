/**
 * Choosing which division of a complete document to preview.
 *
 * A fragment file names its own division: its root element. A complete
 * document — a whole book in one file, or a main file whose includes have
 * been merged — does not, so the caller says where in the source the author
 * is (a file and line, or an element's `xml:id`), and this module turns that
 * into the division upstream's `subtree` parameter should emit. The rest of
 * the document is then pruned to a skeleton around it (skeleton.ts), so the
 * cost of a preview tracks the division, not the book.
 *
 * Which division, exactly, follows PreTeXt's own chunking: with a `level`,
 * the answer is the page that would hold the cursor in a build chunked at
 * that level — the ancestor at that level when the cursor is deeper, or the
 * enclosing division with its child divisions collapsed to headings when it
 * is shallower. Without one, it is the innermost division, whole.
 */

import * as path from "node:path";
import type { Element, Root } from "xast";
import { divisionLevel, findById, isStructural, pathTo } from "./skeleton.js";
import { stampedIdOf } from "./sourcemap.js";
import { includedFileOf } from "./xinclude.js";

export interface SubtreeOptions {
  /**
   * The `xml:id` of the element to preview. An element that is not itself a
   * division selects the division enclosing it. Takes precedence over
   * `file`/`line`.
   */
  id?: string;
  /**
   * The 1-based source line the author is at, selecting the innermost
   * division containing it. A line outside every division (in the prolog or
   * `<docinfo>`, say) selects the nearest division after it, else before it.
   */
  line?: number;
  /**
   * Which file `line` is in — an absolute path, as given to `sourcePath` and
   * resolved the same way. Defaults to the file being rendered, which is the
   * right answer for a single-file document; a line in an xi:included file
   * needs its own path, since each file's lines start at 1.
   */
  file?: string;
  /**
   * Chunk level, with PreTeXt's meaning: the depth at which divisions become
   * pages of their own (1 for chapters of a book or sections of an article,
   * 2 one deeper, and so on). The preview is the page that would hold the
   * selection in a build chunked at that level:
   *
   *  - a selection deeper than `level` previews its ancestor at `level`,
   *    whole, since that whole ancestor is one page there;
   *  - a selection at `level` previews that division, whole;
   *  - a selection shallower than `level` — a chapter's introduction, say —
   *    previews that division as a summary page: its own content, then
   *    links to the divisions nested in it, since those are pages of their
   *    own and only summarized on the shallower page.
   *
   * Omitted, every division is a page of its own: the innermost division
   * around the selection is previewed, as a summary page whenever it
   * contains divisions. Only leaf divisions then render in full, and a
   * cursor at the top of a book shows the book's front matter and a table
   * of its chapters, not the book.
   */
  level?: number;
  /**
   * Render the whole document instead when it has no more than this many
   * elements. Small documents preview whole as fast as any division of them
   * would, and showing all of one is the better preview; this is the knob
   * for "never show the entire document unless it is small". Counted on the
   * xi:include-merged document, which {@link measureDocument} reports.
   */
  wholeDocumentUpTo?: number;
}

/** The division {@link selectDivision} chose. */
export interface SelectedDivision {
  element: Element;
  /** Its `xml:id` — authored, or injected (see {@link ensureXmlId}). */
  id: string;
  /** Whether its child divisions should be collapsed (see `level`). */
  collapse: boolean;
}

function isElement(node: unknown): node is Element {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: string }).type === "element"
  );
}

/** The nearest element on `chain` (root first) that is a division, if any. */
function innermostDivision(chain: Element[]): Element | undefined {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (isStructural(chain[i])) return chain[i];
  }
  return undefined;
}

/**
 * Every division authored in `file`, in document order, with the chain of
 * elements above each. Elements of other files — spliced in by xi:include,
 * or the including file around an included one — are passed through but not
 * matched, since their line numbers count from a different 1.
 */
function divisionsIn(
  tree: Root,
  rootFile: string,
  file: string,
): { element: Element; chain: Element[] }[] {
  const found: { element: Element; chain: Element[] }[] = [];
  const visit = (element: Element, current: string, chain: Element[]): void => {
    const own = includedFileOf(element) ?? current;
    const here = [...chain, element];
    if (own === file && isStructural(element)) {
      found.push({ element, chain: here });
    }
    for (const child of element.children) {
      if (isElement(child)) visit(child, own, here);
    }
  };
  const root = tree.children.find(isElement);
  if (root) visit(root, rootFile, []);
  return found;
}

/**
 * The innermost division containing `line` of `file`; failing that, the
 * first division starting after the line, then the last one before it.
 * `rootFile` is the file the tree's root element was parsed from.
 */
function divisionAtLine(
  tree: Root,
  rootFile: string,
  file: string,
  line: number,
): Element | undefined {
  const divisions = divisionsIn(tree, rootFile, file);
  let enclosing: Element | undefined;
  let following: Element | undefined;
  let preceding: Element | undefined;
  for (const { element } of divisions) {
    const start = element.position?.start.line;
    const end = element.position?.end.line ?? start;
    if (start === undefined || end === undefined) continue;
    if (start <= line && line <= end) {
      // Document order is outermost first, so the last match is innermost.
      enclosing = element;
    } else if (start > line) {
      following ??= element;
    } else {
      preceding = element;
    }
  }
  return enclosing ?? following ?? preceding;
}

/**
 * Pick the division to preview (see the module comment). Returns undefined
 * when the document has no division to pick — an `id` that names nothing,
 * a file with no divisions — which the caller should treat as "render the
 * whole document".
 */
export function selectDivision(
  tree: Root,
  options: SubtreeOptions,
  /** The file the tree's root was parsed from; what `file` defaults to. */
  defaultFile: string,
): SelectedDivision | undefined {
  let element: Element | undefined;
  if (options.id !== undefined) {
    const named = findById(tree, options.id);
    const chain = named && pathTo(tree, named);
    element = chain && innermostDivision(chain);
  } else if (options.line !== undefined) {
    const rootFile = path.resolve(defaultFile);
    const file = path.resolve(options.file ?? defaultFile);
    element = divisionAtLine(tree, rootFile, file, options.line);
  }
  if (!element) return undefined;

  // Without a level, every division is a page of its own: the innermost one
  // is previewed, and when it contains divisions, as a summary of them.
  const chunkLevel = options.level ?? Infinity;
  let collapse = false;
  const chain = pathTo(tree, element) ?? [element];
  const divisionPath = chain.filter(
    (ancestor) => ancestor.name !== "pretext" && ancestor.name !== "mathbook",
  );
  const documentElement = divisionPath[0];
  const hasParts =
    documentElement?.name === "book" &&
    documentElement.children.some(
      (child) => isElement(child) && child.name === "part",
    );
  const own = divisionLevel(divisionPath, hasParts);
  if (own > chunkLevel) {
    // Climb to the ancestor that is a page at this chunk level: the
    // shallowest ancestor whose level is at least `level`.
    for (let i = 0; i < divisionPath.length; i++) {
      const candidate = divisionPath[i];
      if (!isStructural(candidate)) continue;
      if (divisionLevel(divisionPath.slice(0, i + 1), hasParts) >= chunkLevel) {
        element = candidate;
        break;
      }
    }
  } else if (own < chunkLevel) {
    collapse = true;
  }

  return { element, id: ensureXmlId(tree, element), collapse };
}

/**
 * The element's `xml:id`, injecting one when it has none — the very id
 * pretext-assembly.xsl would stamp on it anyway (`parent-id + "-" +
 * position`), so the rendered page's ids, and with them the source map and
 * in-place patching, are the same as without the injection. Needed because
 * both upstream's `subtree` parameter and the skeleton address a division
 * by `xml:id`, and most divisions in a single-file document carry none.
 */
export function ensureXmlId(tree: Root, element: Element): string {
  const authored = element.attributes["xml:id"];
  if (authored) return authored;
  const stamped = stampedIdOf(tree, element) ?? "root-1";
  element.attributes["xml:id"] = stamped;
  return stamped;
}

/** Number of elements in the tree — what the assembly passes' cost tracks. */
export function countElements(tree: Root | Element): number {
  let count = 0;
  for (const child of tree.children) {
    if (isElement(child)) count += 1 + countElements(child);
  }
  return count;
}
