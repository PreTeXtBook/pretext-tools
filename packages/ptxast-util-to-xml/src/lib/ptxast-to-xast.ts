/**
 * ptxast-to-xast: converts a ptxast node tree to xast nodes suitable for
 * serialization with `xast-util-to-xml`.
 *
 * ptxast node types map directly to xast element names. The main exceptions:
 *   - `PtxRoot` (type: 'root') → returns its children converted (not an element)
 *   - `PtxText` (type: 'text') → xast text node
 *   - Leaf/value nodes (m, me, men, mrow, c, pre, program, etc.) that carry a
 *     `value: string` → xast element with a single text child
 */

import type { Element, Text, Root as XastRoot, RootContent } from 'xast';
import type { PtxContent, PtxRoot, PtxNode } from '@pretextbook/ptxast';

// Node types that use `value: string` instead of `children`.
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

type XastNode = Element | Text;

/**
 * Convert a single ptxast node to an xast node (Element or Text).
 * Does not handle `PtxRoot` — use `ptxastToXast` for the full tree.
 */
export function ptxastNodeToXast(node: PtxNode): XastNode {
  if (node.type === 'text') {
    return { type: 'text', value: (node as { type: 'text'; value: string }).value };
  }

  const n = node as PtxNode & {
    type: string;
    attributes?: Record<string, string | undefined>;
    children?: PtxContent[];
    value?: string;
  };

  // Filter out undefined attribute values for xast compatibility
  const attrs: Record<string, string> = {};
  if (n.attributes) {
    for (const [key, val] of Object.entries(n.attributes)) {
      if (val !== undefined) attrs[key] = val;
    }
  }

  if (VALUE_TYPES.has(n.type) && typeof n.value === 'string') {
    return {
      type: 'element',
      name: n.type,
      attributes: attrs,
      children: [{ type: 'text', value: n.value }],
    };
  }

  const children: XastNode[] = (n.children ?? []).map(ptxastNodeToXast);

  return {
    type: 'element',
    name: n.type,
    attributes: attrs,
    children,
  };
}

/**
 * Convert a `PtxRoot` to an xast `Root` node.
 * The xast Root wraps the converted children for use with `xast-util-to-xml`.
 */
export function ptxastToXast(root: PtxRoot): XastRoot {
  const children = root.children.map(ptxastNodeToXast) as RootContent[];
  return { type: 'root', children };
}
