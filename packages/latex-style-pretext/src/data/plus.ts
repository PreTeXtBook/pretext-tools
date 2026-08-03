// The modular-include types accepted by PreTeXt Plus's `\plus` macro.
//
// Source of truth (mirror, not import):
//   unified-latex/packages/unified-latex-to-pretext/libs/pre-conversion-subs/plus-subs.ts
// (`defaultPlusTypes`). `\plus[attrs]{type}{ref}` converts to
// `<plus:type ref="…"/>`, so every entry is a PreTeXt element name. The
// drift-guard test asserts each one still converts without a warning.

/** Types naming a division that lives in its own source file. */
export const PLUS_DIVISION_TYPES: readonly string[] = [
  "frontmatter",
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "preface",
  "biography",
  "dedication",
  "glossary",
  "appendix",
  "index",
  "bibliography",
  "references",
  "exercises",
  "solutions",
  "worksheet",
  "handout",
  "reading-questions",
  "paragraphs",
  "introduction",
  "conclusion",
  "backmatter",
];

/** Types naming an asset or other includable leaf content. */
export const PLUS_ASSET_TYPES: readonly string[] = [
  "image",
  "video",
  "audio",
  "interactive",
  "program",
  "listing",
  "doenet",
  "webwork",
  "sageplot",
  "asymptote",
  "latex-image",
];

/** Every type recognized in `\plus{type}{ref}` without a warning. */
export const PLUS_TYPES: readonly string[] = [
  ...PLUS_DIVISION_TYPES,
  ...PLUS_ASSET_TYPES,
];

/** Which flavour of content a `\plus` type includes, for completion detail. */
export type PlusTypeKind = "division" | "asset";

export const PLUS_TYPE_KIND: ReadonlyMap<string, PlusTypeKind> = new Map([
  ...PLUS_DIVISION_TYPES.map((n) => [n, "division"] as const),
  ...PLUS_ASSET_TYPES.map((n) => [n, "asset"] as const),
]);

export function isKnownPlusType(name: string): boolean {
  return PLUS_TYPE_KIND.has(name);
}
