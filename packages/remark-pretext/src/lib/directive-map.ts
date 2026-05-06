/**
 * Maps directive names (from remark-directive's `:::name`) to their
 * corresponding xast element names and categories.
 *
 * The `type` value is the PreTeXt XML element name (xast `name` field).
 */

export type DirectiveCategory =
  | 'theorem-like'
  | 'definition-like'
  | 'remark-like'
  | 'example-like'
  | 'proof-like'
  | 'solution-like';

export interface DirectiveInfo {
  /** The PreTeXt XML element name (= xast `name` field). */
  type: string;
  category: DirectiveCategory;
}

export const DIRECTIVE_MAP: Readonly<Record<string, DirectiveInfo>> = {
  // theorem-like
  theorem:       { type: 'theorem',       category: 'theorem-like' },
  lemma:         { type: 'lemma',         category: 'theorem-like' },
  corollary:     { type: 'corollary',     category: 'theorem-like' },
  proposition:   { type: 'proposition',   category: 'theorem-like' },
  claim:         { type: 'claim',         category: 'theorem-like' },
  fact:          { type: 'fact',          category: 'theorem-like' },
  conjecture:    { type: 'conjecture',    category: 'theorem-like' },
  axiom:         { type: 'axiom',         category: 'theorem-like' },
  principle:     { type: 'principle',     category: 'theorem-like' },
  hypothesis:    { type: 'hypothesis',    category: 'theorem-like' },
  algorithm:     { type: 'algorithm',     category: 'theorem-like' },
  // definition-like
  definition:    { type: 'definition',    category: 'definition-like' },
  notation:      { type: 'notation',      category: 'definition-like' },
  // remark-like
  remark:        { type: 'remark',        category: 'remark-like' },
  note:          { type: 'note',          category: 'remark-like' },
  observation:   { type: 'observation',   category: 'remark-like' },
  warning:       { type: 'warning',       category: 'remark-like' },
  insight:       { type: 'insight',       category: 'remark-like' },
  assemblage:    { type: 'assemblage',    category: 'remark-like' },
  // example-like
  example:       { type: 'example',       category: 'example-like' },
  question:      { type: 'question',      category: 'example-like' },
  problem:       { type: 'problem',       category: 'example-like' },
  exercise:      { type: 'exercise',      category: 'example-like' },
  activity:      { type: 'activity',      category: 'example-like' },
  exploration:   { type: 'exploration',   category: 'example-like' },
  investigation: { type: 'investigation', category: 'example-like' },
  project:       { type: 'project',       category: 'example-like' },
  // proof-like
  proof:         { type: 'proof',         category: 'proof-like' },
  case:          { type: 'case',          category: 'proof-like' },
  // solution-like
  solution:      { type: 'solution',      category: 'solution-like' },
  hint:          { type: 'hint',          category: 'solution-like' },
  answer:        { type: 'answer',        category: 'solution-like' },
};

/** Set of directive names that are proof/solution-like (used when parsing theorem children). */
export const PROOF_SOLUTION_NAMES = new Set([
  'proof', 'case', 'solution', 'hint', 'answer',
]);
