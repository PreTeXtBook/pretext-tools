/**
 * Context object passed through the conversion pipeline.
 *
 * Provides handlers with awareness of their position in the tree,
 * enabling context-sensitive formatting decisions.
 */

import type { BlockContent, DefinitionContent, PhrasingContent } from 'mdast';

export interface VisitContext {
  /** Parent node, if any. */
  parent?: BlockContent | DefinitionContent | PhrasingContent;
  /** All ancestor nodes in traversal order. */
  ancestors: (BlockContent | DefinitionContent | PhrasingContent)[];
  /** Nesting depth. */
  depth: number;
  /** Accumulated error/warning messages. */
  messages?: ConversionMessage[];
}

export interface ConversionMessage {
  type: 'warning' | 'error';
  reason: string;
  category: string;
  position?: { line?: number; column?: number };
}
