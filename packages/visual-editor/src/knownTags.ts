/**
 * The PreTeXt source tags the visual editor can represent.
 *
 * CONTRACT: this list must contain exactly the tags backed by the editor
 * schema (nodes + marks, translated to their PreTeXt tag names). cleanPtx
 * (utils.ts) passes tags on this list through to the TipTap parser and
 * wraps everything else in the rawptx escape hatch. A tag listed here
 * WITHOUT a schema node behind it is the worst kind of bug: cleanPtx skips
 * the safety wrapper and ProseMirror then silently destroys the element
 * (this shipped four times: conclusion, part, worksheet, pre).
 *
 * The authoritative set is derived from the real schema as
 * `editorSourceTags` in editorExtensions.ts; this static copy exists only
 * because utils.ts cannot import editorExtensions.ts (the extension files
 * import utils.ts — it would be a cycle). A test in roundtrip.spec.ts
 * asserts the two sets are identical, so any drift fails CI.
 *
 * When you add a new element extension: register it in editorExtensions.ts
 * AND add its tag here (the sync test will remind you), plus a green
 * fixture in roundtrip.spec.ts proving it round-trips.
 */

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

// NOTE: conclusion, part, and worksheet are real PreTeXt divisions but have
// no schema node yet, so they are NOT listed — they travel via rawptx until
// someone models them (see the passthrough fixtures in roundtrip.spec.ts).
const divisions = ["introduction", "chapter", "section", "subsection"];

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
  "url",
];
