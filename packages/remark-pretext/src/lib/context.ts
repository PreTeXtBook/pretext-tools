/**
 * Context object passed through the conversion pipeline.
 *
 * Provides handlers with awareness of their position in the tree,
 * enabling context-sensitive formatting decisions.
 */

import type { BlockContent, DefinitionContent, PhrasingContent } from 'mdast';
import type { RootDivisionType, TopLevelDivisionType } from '@pretextbook/ptxast';

export interface VisitContext {
  /** Parent node, if any. */
  parent?: BlockContent | DefinitionContent | PhrasingContent;
  /** All ancestor nodes in traversal order. */
  ancestors: (BlockContent | DefinitionContent | PhrasingContent)[];
  /** Nesting depth. */
  depth: number;
  /** Accumulated error/warning messages. */
  messages?: ConversionMessage[];
  /** Raw source markdown (optional, used for delimiter detection). */
  source?: string;
  /** The division type that a depth-1 heading (`#`) maps to. */
  topLevelDivision: TopLevelDivisionType;
  /** When set, the whole document is wrapped in this root element
   * (`book`/`article`/`slideshow`) and `topLevelDivision` is the root's
   * outermost child division. */
  documentRoot?: RootDivisionType;
  /** Attributes (e.g. from frontmatter `xmlid`/`label`/`component`) to apply
   * to the first root-level division built from the document. */
  topLevelAttributes?: Record<string, string>;
  /** Mutable: set once `topLevelAttributes` has been applied to a division,
   * shared by reference across the recursive conversion of this document. */
  topLevelAttributesApplied?: { done: boolean };
}

export interface ConversionMessage {
  type: 'warning' | 'error';
  reason: string;
  category: string;
  position?: { line?: number; column?: number };
}
