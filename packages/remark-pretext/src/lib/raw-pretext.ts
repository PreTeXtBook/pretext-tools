/**
 * Raw PreTeXt written directly in markdown-style PreTeXt.
 *
 * Markdown hands these over as `html` nodes, and they follow CommonMark's two
 * cases:
 *
 * - **Inline**, each tag is its own node and what's between a pair of tags is
 *   still Markdown (`<fn>about $x$</fn>`), except in the {@link VERBATIM_ELEMENTS}.
 * - **As a block**, the node holds source text up to the next blank line. Here
 *   it all stays PreTeXt through to the closing tag, even past blank lines, so
 *   a pasted `<figure>` or `<program>` survives intact; see {@link collectRawBlocks}.
 *
 * Tags become real elements, so the output stays well-formed. Comments are for
 * the author and are dropped. Anything that doesn't parse or isn't PreTeXt
 * (`<br>`, `<div>`) is left as an `html` node for the converter to flag.
 */

import type { Html, Parent, Root, RootContent } from "mdast";
import type { Element, ElementContent } from "xast";
import { visit } from "unist-util-visit";
import { fromXml } from "xast-util-from-xml";
import {
  getPtxSchemaChildElementNames,
  isPtxSchemaElementName,
} from "@pretextbook/ptxast";

/** A block of raw PreTeXt, standing in the mdast tree in place of `html` nodes. */
export interface RawBlock {
  type: "ptxRaw";
  element: Element;
}

const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Deprecated, so not in the schema, but still common in real documents. */
const DEPRECATED_DISPLAY_MATH = new Set(["me", "men", "mdn"]);

/** Elements whose content is LaTeX or code, which Markdown must not touch. */
export const VERBATIM_ELEMENTS = new Set([
  ...DEPRECATED_DISPLAY_MATH,
  "c",
  "cd",
  "cline",
  "m",
  "md",
  "mrow",
  "pre",
]);

/** Node types that hold blocks. An `html` node anywhere else is an inline tag. */
const BLOCK_PARENTS = new Set([
  "blockquote",
  "containerDirective",
  "listItem",
  "root",
]);

const PARAGRAPH_ONLY = new Set<string>([
  ...DEPRECATED_DISPLAY_MATH,
  ...getPtxSchemaChildElementNames("p"),
]);
for (const name of getPtxSchemaChildElementNames("section")) {
  PARAGRAPH_ONLY.delete(name);
}

function isPretextElement(name: string): boolean {
  return isPtxSchemaElementName(name) || DEPRECATED_DISPLAY_MATH.has(name);
}

/** The nodes in a fragment of XML, or null if it isn't well-formed PreTeXt. */
export function parseRawXml(xml: string): ElementContent[] | null {
  let root;
  try {
    root = fromXml(`<raw>${xml.replace(COMMENT_RE, "")}</raw>`);
  } catch {
    return null;
  }
  const wrapper = root.children.find((node) => node.type === "element");
  const children = (wrapper as Element).children;
  const isPretext = children.every((node) =>
    node.type === "element"
      ? isPretextElement(node.name)
      : node.type !== "instruction",
  );
  return isPretext ? children : null;
}

/** A raw inline tag: the nodes it stands for, plus the element it opens if any. */
export interface RawInlineTag {
  children: ElementContent[];
  opens?: Element;
}

export function parseRawInlineTag(value: string): RawInlineTag | null {
  const children = parseRawXml(value);
  if (children) return { children };
  // An opening tag: self-close it to read its name and attributes.
  const [opens] = parseRawXml(value.replace(/>$/, "/>")) ?? [];
  return opens?.type === "element" ? { children: [], opens } : null;
}

/**
 * The index of the tag in `nodes` closing the element opened at `start`, or -1.
 */
export function findClosingTag(
  nodes: { type: string }[],
  start: number,
  name: string,
): number {
  const opening = new RegExp(`^<${name}(\\s[^]*)?(?<!/)>$`);
  const closing = new RegExp(`^</${name}\\s*>$`);
  let depth = 1;
  for (let i = start + 1; i < nodes.length; i += 1) {
    if (nodes[i].type !== "html") continue;
    const { value } = nodes[i] as Html;
    if (opening.test(value)) depth += 1;
    if (closing.test(value)) depth -= 1;
    if (depth === 0) return i;
  }
  return -1;
}

/**
 * The elements a raw block makes. Text and elements that can only live in a
 * paragraph (a lone `<xref>` line) are gathered into a `<p>`, as they would be
 * if they had started a paragraph of Markdown.
 */
function toBlockElements(nodes: ElementContent[]): Element[] {
  const elements: Element[] = [];
  let paragraph: Element | null = null;
  for (const node of nodes) {
    if (node.type === "element" && !PARAGRAPH_ONLY.has(node.name)) {
      elements.push(node);
      paragraph = null;
      continue;
    }
    if (!paragraph && node.type === "text" && !node.value.trim()) continue;
    if (!paragraph) {
      paragraph = { type: "element", name: "p", attributes: {}, children: [] };
      elements.push(paragraph);
    }
    paragraph.children.push(node);
  }
  return elements;
}

/**
 * Parse the raw block at `blocks[start]`. If it doesn't close by the end of its
 * `html` node, it runs on through the source of the blocks after it, to the
 * first one that does close it. Returns the index of the last block used.
 */
function parseRawBlock(
  blocks: RootContent[],
  start: number,
  source: string | undefined,
  restoreSource: (text: string) => string,
): { nodes: ElementContent[]; end: number } | null {
  const nodes = parseRawXml((blocks[start] as Html).value);
  if (nodes) return { nodes, end: start };

  const from = blocks[start].position?.start.offset;
  if (source === undefined || from === undefined) return null;
  let searched = blocks[start].position?.end.offset;
  for (let end = start + 1; end < blocks.length; end += 1) {
    const to = blocks[end].position?.end.offset;
    if (!source.slice(searched, to).includes("</")) continue;
    searched = to;
    const nodes = parseRawXml(restoreSource(source.slice(from, to)));
    if (nodes) return { nodes, end };
  }
  return null;
}

/**
 * Replace the raw blocks in `tree` with {@link RawBlock} nodes. This has to run
 * before sections are built, since a block can span what look like headings.
 */
export function collectRawBlocks(
  tree: Root,
  source: string | undefined,
  restoreSource: (text: string) => string,
): void {
  visit(tree, (parent) => {
    if (!BLOCK_PARENTS.has(parent.type)) return;
    const blocks = (parent as Parent).children as RootContent[];
    for (let i = 0; i < blocks.length; i += 1) {
      if (blocks[i].type !== "html") continue;
      const raw = parseRawBlock(blocks, i, source, restoreSource);
      if (!raw) continue;
      const elements = toBlockElements(raw.nodes).map(
        (element): RawBlock => ({ type: "ptxRaw", element }),
      );
      blocks.splice(i, raw.end - i + 1, ...(elements as never[]));
      i += elements.length - 1;
    }
  });
}
