// Curated table of container directives supported by the PreTeXt conversion.
//
// Source of truth (mirror, not import):
//   packages/remark-pretext/src/lib/directive-map.ts  (DIRECTIVE_SPEC_TABLE)
// Keep in sync with that file; the drift-guard test (directives.drift.spec.ts)
// asserts every entry here still converts without an "unsupported" warning.
//
// A note on the three directive forms:
//   - CONTAINER directives (`:::name` … `:::`) have a *fixed* vocabulary — the
//     table below. An unknown container name will not convert, so lint flags it.
//   - LEAF directives (`::name{…}`) are the PreTeXt Plus *include* syntax; the
//     converter turns any `::name` into `<plus:name/>`, so no leaf name is ever
//     "unknown". `LEAF_DIRECTIVES` below is only a convenience completion list.
//   - TEXT directives (`:name[…]`) have no converter handler yet (they become
//     `<TODO>` placeholders), so this package neither completes nor lints them.

import type { DirectiveSpec, DirectiveCategory } from "../types";

/** The mirror of `DIRECTIVE_SPEC_TABLE`, minus fields we derive below. */
type ContainerSeed = {
  category: DirectiveCategory;
  requiresStatement: boolean;
  hasNestedTasks?: boolean;
  documentation?: string;
};

const CONTAINER_SEEDS: Record<string, ContainerSeed> = {
  // theorem-like (body wrapped in <statement>, proof hoisted to a sibling)
  theorem: { category: "theorem-like", requiresStatement: true },
  lemma: { category: "theorem-like", requiresStatement: true },
  corollary: { category: "theorem-like", requiresStatement: true },
  proposition: { category: "theorem-like", requiresStatement: true },
  claim: { category: "theorem-like", requiresStatement: true },
  fact: { category: "theorem-like", requiresStatement: true },
  conjecture: { category: "theorem-like", requiresStatement: true },
  axiom: { category: "theorem-like", requiresStatement: true },
  principle: { category: "theorem-like", requiresStatement: true },
  hypothesis: { category: "theorem-like", requiresStatement: true },
  algorithm: { category: "theorem-like", requiresStatement: true },

  // definition-like (also statement-wrapped)
  definition: { category: "definition-like", requiresStatement: true },
  notation: { category: "definition-like", requiresStatement: true },

  // remark-like (no statement wrapping)
  remark: { category: "remark-like", requiresStatement: false },
  note: { category: "remark-like", requiresStatement: false },
  observation: { category: "remark-like", requiresStatement: false },
  warning: { category: "remark-like", requiresStatement: false },
  insight: { category: "remark-like", requiresStatement: false },
  assemblage: { category: "remark-like", requiresStatement: false },

  // example-like (exercise/project/task accept nested :::task children)
  example: { category: "example-like", requiresStatement: false },
  question: { category: "example-like", requiresStatement: false },
  problem: { category: "example-like", requiresStatement: false },
  exercise: {
    category: "example-like",
    requiresStatement: true,
    hasNestedTasks: true,
  },
  activity: { category: "example-like", requiresStatement: false },
  exploration: { category: "example-like", requiresStatement: false },
  investigation: { category: "example-like", requiresStatement: false },
  project: {
    category: "example-like",
    requiresStatement: true,
    hasNestedTasks: true,
  },
  task: {
    category: "example-like",
    requiresStatement: true,
    hasNestedTasks: true,
  },

  // proof-like (no statement wrapping)
  proof: { category: "proof-like", requiresStatement: false },
  case: { category: "proof-like", requiresStatement: false },

  // solution-like (no statement wrapping)
  solution: { category: "solution-like", requiresStatement: false },
  hint: { category: "solution-like", requiresStatement: false },
  answer: { category: "solution-like", requiresStatement: false },
};

/**
 * Exercise-flavored directives whose meaningful children are hint/answer/
 * solution. Mirrors the LaTeX package's `EXERCISE_LIKE` set for consistency.
 */
const EXERCISE_LIKE = new Set([
  "exercise",
  "problem",
  "question",
  "task",
  "activity",
  "exploration",
  "investigation",
]);

/** Derive the boosted child directives for a container from its semantics. */
function childDirectivesFor(name: string, seed: ContainerSeed): string[] {
  const children: string[] = [];
  if (seed.hasNestedTasks) children.push("task");
  if (EXERCISE_LIKE.has(name)) {
    children.push("hint", "answer", "solution");
  } else if (
    seed.category === "theorem-like" ||
    seed.category === "definition-like" ||
    seed.category === "axiom-like"
  ) {
    children.push("proof");
  }
  return children;
}

function seedToSpec(name: string, seed: ContainerSeed): DirectiveSpec {
  const children = childDirectivesFor(name, seed);
  return {
    name,
    type: name,
    category: seed.category,
    kind: "container",
    requiresStatement: seed.requiresStatement,
    hasNestedTasks: seed.hasNestedTasks,
    childDirectives: children.length > 0 ? children : undefined,
    documentation: seed.documentation,
  };
}

/** All supported container directives (`:::name` … `:::`). */
export const CONTAINER_DIRECTIVES: DirectiveSpec[] = Object.entries(
  CONTAINER_SEEDS,
).map(([name, seed]) => seedToSpec(name, seed));

/**
 * Convenience completion list for leaf directives (`::name{…}`). These are the
 * PreTeXt Plus *include* syntax — a reference expanded by a later assembly step
 * (`::section{ref="ch-intro"}` → `<plus:section ref="ch-intro"/>`). Any name is
 * valid, so this list is offered as suggestions but never used for validation.
 */
export const LEAF_DIRECTIVES: DirectiveSpec[] = [
  ["part", "Include a modular part."],
  ["chapter", "Include a modular chapter."],
  ["section", "Include a modular section."],
  ["subsection", "Include a modular subsection."],
  ["subsubsection", "Include a modular subsubsection."],
  ["image", "Include an image asset by `ref`."],
  ["listing", "Include a code listing by `ref`."],
  ["figure", "Include a figure by `ref`."],
  ["table", "Include a table by `ref`."],
].map(([name, documentation]) => ({
  name,
  type: name,
  category: "remark-like" as DirectiveCategory,
  kind: "leaf" as const,
  requiresStatement: false,
  documentation,
}));

/** Lookup from a container directive name to its spec. */
export const CONTAINER_BY_NAME: ReadonlyMap<string, DirectiveSpec> = new Map(
  CONTAINER_DIRECTIVES.map((spec) => [spec.name, spec]),
);

/** True if `name` is a supported container directive. */
export function isKnownContainerDirective(name: string): boolean {
  return CONTAINER_BY_NAME.has(name.toLowerCase());
}
