/**
 * Source map between PreTeXt source locations and rendered HTML ids.
 *
 * The HTML id of every element in the rendered page is the @unique-id stamped
 * by pretext-assembly.xsl, and that stamp is a deterministic depth-first walk
 * (mode="id-attribute" in assets/xsl/pretext-assembly.xsl):
 *
 *     id(el) = @label ?? @xml:id ?? id(parent) + "-" + sibling-position
 *
 * starting from "root" (so the document element is "root-1"). We replicate
 * that walk here over the xinclude-merged xast tree — where every node still
 * carries the line/column of its own source file — producing a map from id to
 * {file, line}. The rendered page is untouched; renders stay byte-identical.
 *
 * Caveat: assembly passes that restructure the tree before the @unique-id
 * stamp (component/version filtering, WeBWorK extraction) would shift the
 * auto-generated ids. Those passes are inert in the portable preview build,
 * and authored @xml:id/@label values are immune regardless (they reset the
 * id chain), so in practice the map matches the page; worst case a lookup
 * lands on a nearby ancestor instead of the exact element.
 */

import type { Element, Root } from "xast";
import { includedFileOf } from "./xinclude.js";

/** One element of the rendered document, in document order. */
export interface SourceMapEntry {
  /** The element's @unique-id — its HTML id when the page emits one. */
  id: string;
  /** Absolute path of the source file the element was authored in. */
  file: string;
  /** 1-based start line of the element in `file`. */
  line: number;
  /** 1-based start column of the element in `file`. */
  column: number;
  /** 1-based line of the element's closing tag in `file`. */
  endLine: number;
  /**
   * Id of the nearest mapped ancestor (or the synthesized wrapper's id in
   * fragment mode). Lets clients fall back outward when an id does not
   * appear in the rendered page (not every element gets an HTML id).
   */
  parent?: string;
}

/** All entries for one rendered document, in document order. */
export type PtxSourceMap = SourceMapEntry[];

function isElement(node: unknown): node is Element {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "element"
  );
}

/**
 * Foreign vocabulary (PreFigure, embedded XHTML). pretext-assembly.xsl does
 * not stamp ids on these; matched pragmatically by the conventional prefixes
 * rather than resolving namespace bindings.
 */
function isForeign(element: Element): boolean {
  return /^(pf|xhtml):/.test(element.name);
}

/**
 * Compute the source map for an xinclude-merged tree (see resolveXIncludesToTree,
 * whose spliced subtrees are tagged with their origin file). `rootFile` is the
 * file the root element was authored in. `parentId`/`position` seat the walk
 * below a synthesized wrapper in fragment mode: a fragment wrapped as
 * <pretext><article><title/>… has wrapper ids root-1 / root-1-1, so its content
 * starts at parentId "root-1-1", position 2 (after the empty <title/>).
 */
export function computeSourceMap(
  tree: Root,
  rootFile: string,
  options?: { parentId?: string; position?: number },
): PtxSourceMap {
  const map: PtxSourceMap = [];
  const root = tree.children.find(isElement);
  if (root) {
    const parentId = options?.parentId ?? "root";
    walk(root, parentId, options?.position ?? 1, rootFile, parentId, map);
  }
  return map;
}

function walk(
  element: Element,
  parentId: string,
  position: number,
  file: string,
  parentStampedId: string | undefined,
  map: PtxSourceMap,
): void {
  const ownFile = includedFileOf(element) ?? file;
  let stampedId: string | undefined;
  let childParentId: string;
  if (isForeign(element)) {
    // Not stamped. The upstream template recurses without parameters, so in
    // XSLT 1.0 the children restart from the default parent-id — mirror that.
    childParentId = "root";
  } else {
    // Presence tests, like the XSLT's test="@label" / test="@xml:id".
    const authored =
      element.attributes["label"] ?? element.attributes["xml:id"];
    stampedId = authored != null ? authored : `${parentId}-${position}`;
    map.push({
      id: stampedId,
      file: ownFile,
      line: element.position?.start.line ?? 1,
      column: element.position?.start.column ?? 1,
      endLine: element.position?.end.line ?? element.position?.start.line ?? 1,
      parent: parentStampedId,
    });
    childParentId = stampedId;
  }
  let index = 0;
  for (const child of element.children) {
    if (isElement(child)) {
      index += 1;
      walk(
        child,
        childParentId,
        index,
        ownFile,
        stampedId ?? parentStampedId,
        map,
      );
    }
  }
}

/**
 * The entry to sync to for a cursor at `line`, given the entries of ONE file
 * in document order (start lines are non-decreasing within a file): the last
 * element starting at or before the line — the deepest/nearest element above
 * the cursor. Falls back to the file's first entry for a cursor in the prolog.
 */
export function findSourceMapEntry(
  entries: PtxSourceMap,
  line: number,
): SourceMapEntry | undefined {
  let found: SourceMapEntry | undefined;
  for (const entry of entries) {
    if (entry.line <= line) {
      found = entry;
    }
  }
  return found ?? entries[0];
}
