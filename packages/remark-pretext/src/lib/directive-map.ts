/**
 * Maps directive names (from remark-directive's `:::name`) to their
 * corresponding xast element names and semantic specifications.
 *
 * Architecture (Phase 2 refactor):
 * - Separated semantic specs (requiresStatement) from routing logic
 * - Factories apply spec-driven semantic rules uniformly
 * - Adding new directives requires only configuration change, not new functions
 */

export type DirectiveCategory =
  | 'theorem-like'
  | 'proof-like'
  | 'definition-like'
  | 'axiom-like'
  | 'remark-like'
  | 'example-like'
  | 'project-like'
  | 'exercise-like'
  | 'solution-like';

/**
 * Semantic specification for how a directive type should be converted.
 * This pattern mirrors unified-latex-to-pretext's factory specifications.
 */
export interface DirectiveSpec {
  /** The PreTeXt XML element name (= xast `name` field). */
  type: string;
  /** Routing category for handler selection. */
  category: DirectiveCategory;
  /**
   * If true, the directive's body content is wrapped in a <statement> element,
   * and proof/solution siblings are extracted as siblings of the statement
   * (not children of it). This matches PreTeXt semantics where theorems have:
   *   <theorem><title/><statement>...</statement><proof/></theorem>
   * 
   * If false, content is added directly without statement wrapping.
   */
  requiresStatement: boolean;
  /**
   * If true, this directive can have nested task children.
   * Content before the first task becomes an <introduction> wrapper.
   * Example:
   *   <exercise><introduction>...</introduction><task>...</task><task>...</task></exercise>
   * 
   * Only applies if nested tasks are actually present in the body.
   * If no tasks are found, requiresStatement still applies.
   */
  hasNestedTasks?: boolean;
}

/**
 * Backwards-compatible type for code that only needs type+category.
 * @deprecated Use DirectiveSpec instead for new code.
 */
export interface DirectiveInfo {
  type: string;
  category: DirectiveCategory;
}

/**
 * Semantic specification table: directive name → spec.
 * 
 * Pattern mirrors unified-latex-to-pretext's environment specification approach:
 * Declarative table + factory functions apply rules uniformly.
 * To add a new directive: just add an entry here.
 */
export const DIRECTIVE_SPEC_TABLE: Readonly<Record<string, DirectiveSpec>> = {
  // theorem-like (requires statement wrapping)
  theorem:       { type: 'theorem',       category: 'theorem-like',   requiresStatement: true },
  lemma:         { type: 'lemma',         category: 'theorem-like',   requiresStatement: true },
  corollary:     { type: 'corollary',     category: 'theorem-like',   requiresStatement: true },
  proposition:   { type: 'proposition',   category: 'theorem-like',   requiresStatement: true },
  claim:         { type: 'claim',         category: 'theorem-like',   requiresStatement: true },
  fact:          { type: 'fact',          category: 'theorem-like',   requiresStatement: true },
  conjecture:    { type: 'conjecture',    category: 'theorem-like',   requiresStatement: true },
  axiom:         { type: 'axiom',         category: 'theorem-like',   requiresStatement: true },
  principle:     { type: 'principle',     category: 'theorem-like',   requiresStatement: true },
  hypothesis:    { type: 'hypothesis',    category: 'theorem-like',   requiresStatement: true },
  algorithm:     { type: 'algorithm',     category: 'theorem-like',   requiresStatement: true },
  
  // definition-like (requires statement wrapping)
  definition:    { type: 'definition',    category: 'definition-like', requiresStatement: true },
  notation:      { type: 'notation',      category: 'definition-like', requiresStatement: true },
  
  // remark-like (no statement wrapping)
  remark:        { type: 'remark',        category: 'remark-like',   requiresStatement: false },
  note:          { type: 'note',          category: 'remark-like',   requiresStatement: false },
  observation:   { type: 'observation',   category: 'remark-like',   requiresStatement: false },
  warning:       { type: 'warning',       category: 'remark-like',   requiresStatement: false },
  insight:       { type: 'insight',       category: 'remark-like',   requiresStatement: false },
  assemblage:    { type: 'assemblage',    category: 'remark-like',   requiresStatement: false },
  
  // example-like (exercise/project/task support nested tasks; require statement if no nested tasks)
  example:       { type: 'example',       category: 'example-like',  requiresStatement: false },
  question:      { type: 'question',      category: 'example-like',  requiresStatement: false },
  problem:       { type: 'problem',       category: 'example-like',  requiresStatement: false },
  exercise:      { type: 'exercise',      category: 'example-like',  requiresStatement: true, hasNestedTasks: true },
  activity:      { type: 'activity',      category: 'example-like',  requiresStatement: false },
  exploration:   { type: 'exploration',   category: 'example-like',  requiresStatement: false },
  investigation: { type: 'investigation', category: 'example-like',  requiresStatement: false },
  project:       { type: 'project',       category: 'example-like',  requiresStatement: true, hasNestedTasks: true },
  
  // task (can have nested tasks, requires statement if no nested tasks)
  task:          { type: 'task',          category: 'example-like',  requiresStatement: true, hasNestedTasks: true },
  
  // proof-like (no statement wrapping)
  proof:         { type: 'proof',         category: 'proof-like',    requiresStatement: false },
  case:          { type: 'case',          category: 'proof-like',    requiresStatement: false },
  
  // solution-like (no statement wrapping)
  solution:      { type: 'solution',      category: 'solution-like', requiresStatement: false },
  hint:          { type: 'hint',          category: 'solution-like', requiresStatement: false },
  answer:        { type: 'answer',        category: 'solution-like', requiresStatement: false },
};

/**
 * @deprecated Use DIRECTIVE_SPEC_TABLE directly or via getDirectiveSpec().
 * Kept for backwards compatibility. Returns spec as old DirectiveInfo type.
 */
export const DIRECTIVE_MAP: Readonly<Record<string, DirectiveInfo>> = DIRECTIVE_SPEC_TABLE as any;

/** Get directive spec, or undefined if not found. */
export function getDirectiveSpec(name: string): DirectiveSpec | undefined {
  return DIRECTIVE_SPEC_TABLE[name];
}

/** Set of directive names that are proof/solution-like (used when separating statement siblings). */
export const PROOF_SOLUTION_NAMES = new Set(
  Object.entries(DIRECTIVE_SPEC_TABLE)
    .filter(([_, spec]) => spec.category === 'proof-like' || spec.category === 'solution-like')
    .map(([name]) => name)
);
