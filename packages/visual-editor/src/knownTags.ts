const theoremLikeElements = [
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "claim",
  "fact",
  "proof",
];

const remarkLikeElements = [
  "convention",
  "insight",
  "note",
  "observation",
  "remark",
  "warning",
];

const axiomLikeElements = [
  "assumption",
  "axiom",
  "conjecture",
  "heuristic",
  "hypothesis",
  "principle",
];

const divisions = [
  "introduction",
  "conclusion",
  "part",
  "chapter",
  "section",
  "subsection",
  "worksheet",
];

const exampleLikeElements = ["example", "question", "problem"];

const solutionLikeElements = ["solution", "answer", "hint"];

export const KNOWN_TAGS = [
  "ptxdoc",
  "p",
  "m",
  "me",
  "md",
  "ol",
  "ul",
  "li",
  ...divisions,
  "title",
  "definition",
  "statement",
  ...theoremLikeElements,
  ...axiomLikeElements,
  ...remarkLikeElements,
  ...exampleLikeElements,
  ...solutionLikeElements,
  "term",
  "em",
  "alert",
  "c",
  "pre",
  "url",
];
