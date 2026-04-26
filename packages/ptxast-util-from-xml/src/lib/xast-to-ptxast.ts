/**
 * xast-to-ptxast: converts generic xast nodes (produced by xast-util-from-xml)
 * into typed ptxast nodes.
 *
 * Strategy:
 *   - xast `root`    → PtxRoot (children converted recursively)
 *   - xast `text`    → PtxText (whitespace-only text nodes are dropped)
 *   - xast `element` with a name in VALUE_TYPES and only text children
 *                    → ptxast value node (type = name, value = text content)
 *   - xast `element` otherwise
 *                    → ptxast parent node (type = name, attributes = attrs,
 *                       children converted recursively)
 *   - xast `comment`, `instruction`, `cdata`, `doctype`
 *                    → dropped (not representable in ptxast)
 */

import type { Root as XastRoot, RootContent, Element, Text as XastText } from 'xast';
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
    default:        return null; // comment, instruction, cdata, doctype → drop
  }
}

function convertText(node: XastText): PtxText | null {
  if (/^\s*$/.test(node.value)) return null; // drop whitespace-only
  return { type: 'text', value: node.value };
}

function convertElement(el: Element): PtxContent {
  const { name, attributes, children } = el;

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
    else if (child.type === 'element') result += extractTextValue((child as Element).children as RootContent[]);
  }
  return result;
}
