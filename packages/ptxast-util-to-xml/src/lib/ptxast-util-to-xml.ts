/**
 * ptxast-util-to-xml: serialize a ptxast tree to a PreTeXt XML string.
 *
 * Converts ptxast nodes → xast nodes, then uses `xast-util-to-xml` for
 * the final string serialization.
 */

import { toXml } from 'xast-util-to-xml';
import type { PtxRoot, PtxContent, PtxNode } from '@pretextbook/ptxast';
import { ptxastNodeToXast, ptxastToXast } from './ptxast-to-xast.js';

export type { PtxRoot };

/**
 * Serialize a `PtxRoot` to a PreTeXt XML string.
 * The root's children are serialized as top-level XML nodes.
 */
export function ptxastRootToXml(root: PtxRoot): string {
  const xast = ptxastToXast(root);
  return toXml(xast.children);
}

/**
 * Serialize a single ptxast node to an XML string.
 */
export function ptxastNodeToXml(node: PtxNode): string {
  return toXml(ptxastNodeToXast(node));
}

export { ptxastNodeToXast, ptxastToXast };
