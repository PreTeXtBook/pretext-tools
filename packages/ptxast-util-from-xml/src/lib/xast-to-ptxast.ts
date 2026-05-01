/**
 * xast-to-ptxast: converts generic xast nodes (produced by xast-util-from-xml)
 * into typed ptxast nodes.
 *
 * Strategy:
 *   - xast `root`    → PtxRoot (children converted recursively)
 *   - xast `text`    → PtxText; whitespace-only nodes with newlines are dropped
 *                    (indentation whitespace); space-only nodes are preserved
 *                    since they may be significant between inline elements
 *   - xast `cdata`   → PtxText (CDATA content treated identically to text)
 *   - xast `element` with a name in VALUE_TYPES and only text children
 *                    → ptxast value node (type = name, value = text content)
 *   - xast `element` otherwise
 *                    → ptxast parent node (type = name, attributes = attrs,
 *                       children converted recursively)
 *   - xast `comment`, `instruction`, `cdata`, `doctype`
 *                    → dropped (not representable in ptxast)
 */

import type { Root as XastRoot, RootContent, Element, Text as XastText, Cdata } from 'xast';
import type { PtxRoot, PtxContent, PtxText } from '@pretextbook/ptxast';

// These element names use `value: string` in ptxast instead of `children`.
const VALUE_TYPES = new Set([
  'pre',
  'program',
  'prompt',
  'input',
  'output',
  'm',
  'me',
  'men',
  'mrow',
  'c',
]);

// ---------------------------------------------------------------------------
// Public converters
// ---------------------------------------------------------------------------

/**
 * Convert a xast `Root` to a `PtxRoot`.
 * Whitespace-only text nodes at the top level are dropped.
 */
export function xastToPtxast(root: XastRoot): PtxRoot {
  const children = convertChildren(root.children as RootContent[]);
  return { type: 'root', children };
}

/**
 * Convert a single xast `Element` to a ptxast node.
 * Useful for converting document fragments.
 */
export function xastElementToPtxast(el: Element): PtxContent {
  return convertElement(el);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function convertChildren(nodes: RootContent[]): PtxContent[] {
  const result: PtxContent[] = [];
  for (const node of nodes) {
    const converted = convertNode(node);
    if (converted !== null) result.push(converted);
  }
  return result;
}

function convertNode(node: RootContent): PtxContent | null {
  switch (node.type) {
    case 'element': return convertElement(node as Element);
    case 'text':    return convertText(node as XastText);
    case 'cdata':   return convertCdata(node as Cdata);
    default:        return null; // comment, instruction, doctype → drop
  }
}

function convertText(node: XastText): PtxText | null {
  // Drop whitespace-only nodes that contain newlines (indentation/formatting).
  // Preserve single-space and tab-only nodes — they may be significant between
  // inline elements (e.g., `<em>a</em> <em>b</em>`).
  if (/^\s*$/.test(node.value) && /[\n\r]/.test(node.value)) return null;
  return { type: 'text', value: node.value };
}

function convertCdata(node: Cdata): PtxText {
  return { type: 'text', value: node.value };
}

function convertElement(el: Element): PtxContent {
  const { name, attributes, children } = el;

  if (name === 'md' || name === 'mdn') {
    const mrowElements = (children as RootContent[]).filter(
      (child): child is Element => child.type === 'element' && (child as Element).name === 'mrow'
    );

    if (mrowElements.length > 0) {
      return {
        type: name,
        ...(Object.keys(attributes).length ? { attributes } : {}),
        children: mrowElements.map((mrow) => convertElement(mrow)),
      } as unknown as PtxContent;
    }

    return {
      type: name,
      ...(Object.keys(attributes).length ? { attributes } : {}),
      value: extractTextValue(children as RootContent[]),
    } as unknown as PtxContent;
  }

  if (VALUE_TYPES.has(name)) {
    return {
      type: name,
      ...(Object.keys(attributes).length ? { attributes } : {}),
      value: extractTextValue(children as RootContent[]),
    } as unknown as PtxContent;
  }

  const ptxChildren = convertChildren(children as RootContent[]);

  return {
    type: name,
    ...(Object.keys(attributes).length ? { attributes } : {}),
    children: ptxChildren,
  } as unknown as PtxContent;
}

/** Extract all text content from xast children (for value nodes). */
function extractTextValue(children: RootContent[]): string {
  let result = '';
  for (const child of children) {
    if (child.type === 'text') result += (child as XastText).value;
    else if (child.type === 'cdata') result += (child as Cdata).value;
    else if (child.type === 'element') result += extractTextValue((child as Element).children as RootContent[]);
  }
  return result;
}
