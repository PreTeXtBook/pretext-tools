/**
 * Generic directive builder factory.
 * 
 * Applies semantic rules from DirectiveSpec uniformly to all directives.
 * Pattern mirrors unified-latex-to-pretext's envFactory approach.
 * 
 * This is the key insight: instead of separate buildTheoremLike(),
 * buildProofLike(), buildRemarkLike() functions, we have ONE function
 * that respects the spec's requiresStatement flag.
 */

import type { BlockContent, DefinitionContent } from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import type { Element } from 'xast';
import type { DirectiveSpec } from './directive-map.js';
import { PROOF_SOLUTION_NAMES } from './directive-map.js';
import type { VisitContext } from './context.js';

type XastChild = Element | { type: 'text'; value: string };

function el(
  name: string,
  children: XastChild[],
  attributes?: Record<string, string>,
): Element {
  return {
    type: 'element',
    name,
    attributes: attributes ?? {},
    children: children as Element['children'],
  };
}

/**
 * Generic factory function: applies semantic rules from spec.
 * 
 * @param spec Semantic specification for this directive type
 * @param attrs HTML/XML attributes for the element
 * @param titleEl Optional <title> element (extracted from first paragraph if present)
 * @param children Body content of the directive
 * @param ctx Visitor context
 * @param convertBlock Callback to recursively convert block children
 * @param convertDirective Callback to recursively convert nested directives
 * 
 * @returns XAST element for this directive
 */
export function buildDirectiveWithSpec(
  spec: DirectiveSpec,
  attrs: Record<string, string> | undefined,
  titleEl: Element | null,
  children: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext,
  convertBlock: (child: BlockContent | DefinitionContent, ctx: VisitContext) => Element | null,
  convertDirective: (node: ContainerDirective, ctx: VisitContext) => Element | null,
): Element {
  const result: Element[] = [];

  // Rule 1: Always add title first if present
  if (titleEl) {
    result.push(titleEl);
  }

  // Rule 2: Apply requiresStatement rule
  if (spec.requiresStatement) {
    // Separate body content from proof/solution siblings
    const bodyContent: Array<BlockContent | DefinitionContent> = [];
    const siblings: Element[] = [];

    for (const child of children) {
      if (
        child.type === 'containerDirective' &&
        PROOF_SOLUTION_NAMES.has((child as ContainerDirective).name)
      ) {
        const converted = convertDirective(child as ContainerDirective, ctx);
        if (converted) siblings.push(converted);
      } else {
        bodyContent.push(child);
      }
    }

    // Wrap body in <statement> (if body is non-empty)
    if (bodyContent.length > 0) {
      const statementChildren = bodyContent
        .map((child) => convertBlock(child, ctx))
        .filter((n): n is Element => n !== null);
      if (statementChildren.length > 0) {
        result.push(el('statement', statementChildren));
      }
    }

    // Append proof/solution siblings (not inside statement)
    result.push(...siblings);
  } else {
    // No statement wrapping: convert all children directly
    const converted = children
      .map((child) => convertBlock(child, ctx))
      .filter((n): n is Element => n !== null);
    result.push(...converted);
  }

  return el(spec.type, result, attrs);
}
