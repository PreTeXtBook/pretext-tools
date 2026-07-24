// Curated table of environments supported by the PreTeXt conversion.
//
// Source of truth (mirror, not import):
//   unified-latex/packages/unified-latex-to-pretext/libs/pre-conversion-subs/environment-subs.ts
// Keep in sync with that file; the drift-guard test asserts every entry here
// still converts without an "unsupported" warning.

import type { EnvironmentSpec } from "../types";
import { isKnownMathEnvironment } from "./math";

/**
 * Environments handled explicitly by `environmentReplacements` (not via the
 * theorem-like alias generator below). Layout/verbatim/structural containers.
 */
const SPECIAL_ENVIRONMENTS: EnvironmentSpec[] = [
  {
    name: "enumerate",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "list",
    snippet: "\n\t\\item $0\n",
    documentation: "Ordered list. Converts to `<ol>`.",
  },
  {
    name: "itemize",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "list",
    snippet: "\n\t\\item $0\n",
    documentation: "Unordered list. Converts to `<ul>`.",
  },
  {
    name: "tabular",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "structural",
    snippet: "{${1:cc}}\n\t$0\n",
    documentation: "Table body. Converts to a PreTeXt `<tabular>`.",
  },
  {
    name: "center",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "block",
    documentation: "Converts to `<blockquote>`.",
  },
  {
    name: "quote",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "block",
    documentation: "Converts to `<blockquote>`.",
  },
  {
    name: "figure",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "structural",
    documentation: "Converts to `<figure>`. Use `\\caption{}` for the caption.",
  },
  {
    name: "table",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "structural",
    documentation: "Converts to `<table>`. Use `\\caption{}` for the title.",
  },
  {
    name: "code",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "verbatim",
    documentation: "Raw content emitted inside `<pre>`.",
  },
  {
    name: "poem",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
    documentation: "Lines split on `\\\\`, stanzas on blank lines.",
  },
  {
    name: "sidebyside",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "structural",
    childEnvironments: ["stack"],
    documentation: "Side-by-side layout container.",
  },
  {
    name: "program",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "verbatim",
    documentation: "Raw code inside `<program><input>`; optional `[language]`.",
  },
  {
    name: "console",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "verbatim",
    documentation: "Raw content inside `<console>`.",
  },
  {
    name: "sage",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "verbatim",
    documentation: "Raw input inside `<sage><input>`.",
  },
  {
    name: "webwork",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "structural",
    documentation: "WeBWorK problem container.",
  },
  // Frontmatter / structural containers
  {
    name: "preface",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "biography",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "dedication",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "glossary",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "biblio",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "gi",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "structural",
  },
  // Division-level blocks
  {
    name: "exercises",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "exercisegroup",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
    childEnvironments: ["hint", "answer", "solution"],
  },
  {
    name: "subexercises",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "worksheet",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "handout",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "reading-questions",
    aliases: ["readingquestions"],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "solutions",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "introduction",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "conclusion",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "paragraphs",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "objectives",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  {
    name: "outcomes",
    aliases: [],
    requiresStatement: false,
    titleArg: true,
    kind: "structural",
  },
  // Figure-like named containers
  {
    name: "list",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "structural",
  },
  {
    name: "listing",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "structural",
  },
  // Side-by-side sub-structure
  {
    name: "sbsgroup",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "structural",
  },
  {
    name: "stack",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "structural",
  },
  // Exam document-class list environments (mirrors `examEnvironments`).
  {
    name: "questions",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "list",
    snippet: "\n\t\\question $0\n",
    documentation: "Exam-class list of questions.",
  },
  {
    name: "parts",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "list",
    snippet: "\n\t\\part $0\n",
  },
  {
    name: "subparts",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "list",
    snippet: "\n\t\\subpart $0\n",
  },
  {
    name: "subsubparts",
    aliases: [],
    requiresStatement: false,
    titleArg: false,
    kind: "list",
    snippet: "\n\t\\subsubpart $0\n",
  },
];

/**
 * Theorem-like / block environments and their accepted shorthand aliases.
 * Mirrors `genEnvironmentReplacements`'s `envAliases` table verbatim.
 */
const ENV_ALIASES: Record<
  string,
  { requiresStatement: boolean; aliases: string[] }
> = {
  abstract: { requiresStatement: false, aliases: ["abs", "abstr"] },
  acknowledgement: { requiresStatement: false, aliases: ["ack"] },
  algorithm: { requiresStatement: true, aliases: ["algo", "alg"] },
  answer: { requiresStatement: false, aliases: ["ans"] },
  assumption: { requiresStatement: true, aliases: ["assu", "ass"] },
  axiom: { requiresStatement: true, aliases: ["axm"] },
  claim: { requiresStatement: true, aliases: ["cla"] },
  conjecture: { requiresStatement: true, aliases: ["con", "conj", "conjec"] },
  activity: { requiresStatement: false, aliases: [] },
  aside: { requiresStatement: false, aliases: [] },
  assemblage: { requiresStatement: false, aliases: [] },
  biographical: { requiresStatement: false, aliases: [] },
  case: { requiresStatement: false, aliases: [] },
  computation: { requiresStatement: false, aliases: ["comp"] },
  construction: { requiresStatement: false, aliases: [] },
  convention: { requiresStatement: false, aliases: ["conv"] },
  corollary: {
    requiresStatement: true,
    aliases: ["cor", "corr", "coro", "corol", "corss"],
  },
  definition: {
    requiresStatement: true,
    aliases: ["def", "defn", "dfn", "defi", "defin", "de"],
  },
  example: {
    requiresStatement: true,
    aliases: ["exam", "exa", "eg", "exmp", "expl", "exm"],
  },
  exercise: { requiresStatement: true, aliases: ["exer", "exers"] },
  data: { requiresStatement: false, aliases: [] },
  exploration: { requiresStatement: false, aliases: [] },
  fact: { requiresStatement: true, aliases: [] },
  heuristic: { requiresStatement: true, aliases: [] },
  hint: { requiresStatement: false, aliases: [] },
  historical: { requiresStatement: false, aliases: [] },
  hypothesis: { requiresStatement: true, aliases: ["hyp"] },
  identity: { requiresStatement: true, aliases: ["idnty"] },
  insight: { requiresStatement: false, aliases: [] },
  investigation: { requiresStatement: false, aliases: [] },
  lemma: { requiresStatement: true, aliases: ["lem", "lma", "lemm", "lm"] },
  notation: {
    requiresStatement: false,
    aliases: ["no", "nota", "ntn", "nt", "notn", "notat"],
  },
  note: { requiresStatement: false, aliases: ["notes"] },
  observation: { requiresStatement: false, aliases: ["obs"] },
  principle: { requiresStatement: true, aliases: [] },
  problem: { requiresStatement: true, aliases: ["prob", "prb"] },
  project: { requiresStatement: false, aliases: [] },
  proof: { requiresStatement: false, aliases: ["pf", "prf", "demo"] },
  proposition: {
    requiresStatement: true,
    aliases: ["prop", "pro", "prp", "props"],
  },
  question: {
    requiresStatement: true,
    aliases: ["qu", "ques", "quest", "qsn"],
  },
  remark: {
    requiresStatement: false,
    aliases: ["rem", "rmk", "rema", "bem", "subrem"],
  },
  task: { requiresStatement: true, aliases: [] },
  technology: { requiresStatement: false, aliases: ["tech"] },
  theorem: {
    requiresStatement: true,
    aliases: ["thm", "theo", "theor", "thmss", "thrm"],
  },
  solution: { requiresStatement: false, aliases: ["sol"] },
  warning: { requiresStatement: false, aliases: ["warn", "wrn"] },
};

/** Exercise-like environments whose meaningful children are hint/answer/solution. */
const EXERCISE_LIKE = new Set([
  "exercise",
  "problem",
  "question",
  "task",
  "activity",
  "exploration",
  "investigation",
]);

function aliasSpecToEnvironment(
  name: string,
  spec: { requiresStatement: boolean; aliases: string[] },
): EnvironmentSpec {
  let childEnvironments: string[] | undefined;
  if (EXERCISE_LIKE.has(name)) {
    childEnvironments = ["hint", "answer", "solution"];
  } else if (spec.requiresStatement) {
    childEnvironments = ["proof"];
  }
  return {
    name,
    aliases: spec.aliases,
    requiresStatement: spec.requiresStatement,
    titleArg: true,
    kind: "block",
    childEnvironments,
  };
}

/** All supported environments, canonical entries only (aliases live on `.aliases`). */
export const ENVIRONMENTS: EnvironmentSpec[] = [
  ...SPECIAL_ENVIRONMENTS,
  ...Object.entries(ENV_ALIASES).map(([name, spec]) =>
    aliasSpecToEnvironment(name, spec),
  ),
];

/** Lookup from any accepted name (canonical or alias) to its canonical spec. */
export const ENVIRONMENT_BY_NAME: ReadonlyMap<string, EnvironmentSpec> =
  (() => {
    const map = new Map<string, EnvironmentSpec>();
    for (const spec of ENVIRONMENTS) {
      map.set(spec.name, spec);
      for (const alias of spec.aliases) {
        map.set(alias, spec);
      }
    }
    return map;
  })();

export function isKnownEnvironment(name: string): boolean {
  return ENVIRONMENT_BY_NAME.has(name);
}

/**
 * True if `name` is a supported environment in any context: a curated PreTeXt
 * environment (or alias) or a KaTeX math environment (align, pmatrix, ...).
 * Used by the "unknown environment" lint check.
 */
export function isKnownAnyEnvironment(name: string): boolean {
  return ENVIRONMENT_BY_NAME.has(name) || isKnownMathEnvironment(name);
}
