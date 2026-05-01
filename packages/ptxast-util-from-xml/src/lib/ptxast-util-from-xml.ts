/**
 * ptxast-util-from-xml: parse a PreTeXt XML string into a ptxast PtxRoot.
 *
 * Parses via `xast-util-from-xml`, then narrows the generic xast elements
 * into typed ptxast nodes.
 */

import { fromXml } from 'xast-util-from-xml';
import type { PtxRoot, PtxContent } from '@pretextbook/ptxast';
import { xastToPtxast, xastElementToPtxast } from './xast-to-ptxast.js';
import type { Element } from 'xast';

export type { PtxRoot };

/**
 * Parse a PreTeXt XML string into a `PtxRoot`.
 *
 * The xast root is converted directly; its children become the PtxRoot's
 * children. This means a full PreTeXt document (`<pretext><book>…`) produces
 * a PtxRoot whose first child is a `pretext` node, while a fragment
 * (`<p>Hello</p>`) produces a PtxRoot whose first child is a `p` node.
 */
export function ptxastFromXml(xml: string): PtxRoot {
  const xast = fromXml(xml);
  return xastToPtxast(xast);
}

/**
 * Parse a single PreTeXt XML element string (e.g. `<theorem>…</theorem>`)
 * into a ptxast node.
 *
 * Throws if the XML does not have exactly one root element.
 */
export function ptxastNodeFromXml(xml: string): PtxContent {
  const xast = fromXml(xml);
  const elements = xast.children.filter(c => c.type === 'element') as Element[];
  if (elements.length !== 1) {
    throw new Error(
      `ptxastNodeFromXml: expected exactly one root element, got ${elements.length}`
    );
  }
  return xastElementToPtxast(elements[0]);
}

export { xastToPtxast, xastElementToPtxast };
