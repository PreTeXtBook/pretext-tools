/**
 * @pretextbook/ptxast
 *
 * Typed xast (XML AST) definitions for PreTeXt documents.
 *
 * Exports two layers:
 * 1. **Generated interfaces** (`generated-interfaces.ts`)  auto-generated from the official
 *    PreTeXt RNG schema via `relax-ng-to-typescript`. Regenerate with `npm run generate-types`.
 * 2. **Curated layer** (`curated.ts`)  handwritten type aliases, semantic union types,
 *    value-element helpers, and backwards-compat aliases.
 *
 * All nodes follow the xast convention:
 *   `{ type: 'element', name: 'section', attributes: {...}, children: [...] }`
 *
 * @example
 * ```ts
 * import type { Root } from 'xast';
 * import type { Section, Theorem, PtxBlockContent } from '@pretextbook/ptxast';
 * import { section, theorem, p, text } from '@pretextbook/ptxast';
 * ```
 */

export type {
  // Document-level
  PtxRoot,
  Pretext,
  Book,
  Article,

  // Front/back matter
  Frontmatter,
  Backmatter,
  Titlepage,
  Author,
  Title,
  Subtitle,

  // Divisions
  Part,
  Chapter,
  Section,
  Subsection,
  Subsubsection,
  Paragraphs,
  Appendix,

  // Block environments (theorem-like)
  Theorem,
  Lemma,
  Corollary,
  Proposition,
  Claim,
  Fact,
  Conjecture,
  OpenConjecture,
  OpenProblem,
  OpenQuestion,
  Axiom,
  Principle,
  Hypothesis,

  // Block environments (definition-like)
  Definition,
  Notation,

  // Block environments (remark-like)
  Remark,
  Note,
  Observation,
  Warning,
  Insight,

  // Block environments (example-like)
  Example,
  Question,
  Problem,
  Exercise,
  Activity,
  Exploration,
  Investigation,
  Project,
  Demonstration,

  // Block environments (proof/solution)
  Proof,
  Solution,
  Answer,
  Hint,
  Case,
  Statement,

  // Tasks
  Task,

  // Block environments (other)
  Algorithm,
  Assemblage,
  Biblio,
  Listing,

  // Paragraphs and blocks
  P,
  Blockquote,
  Pre,

  // Lists
  Ol,
  Ul,
  Li,
  Dl,
  Di,
  Dt,
  Dd,

  // Figure/table/media
  Figure,
  Table,
  Tabular,
  Sidebyside,
  Sbsgroup,
  Image,
  Caption,
  Description,

  // Program/code
  Program,
  Console,
  Sage,
  Stack,
  Prompt,
  Input,
  Output,

  // Math
  M,
  Me,
  Men,
  Md,
  Mdn,
  Mrow,

  // Inline
  Em,
  Alert,
  Term,
  C,
  Q,
  Sq,
  Pubtitle,
  Stitle,

  // References
  Xref,
  Url,
  Fn,
  Idx,
  H,

  // Text node
  PtxText,

  // Union types
  PtxContent,
  PtxBlockContent,
  PtxDivisionContent,
  PtxDivisionElement,
  PtxInlineContent,
  PtxInlineElement,
  PtxBlockElement,
  PtxMathContent,
  PtxTheoremLikeElement,
  PtxAllElement,
} from './types/index.js';

export { getPtxTextContent, PTX_VALUE_ELEMENT_NAMES } from './types/curated.js';

export { ptxSchemaElementChildren } from './types/generated.js';

export type {
  GeneratedPtxCuratedElementName,
  GeneratedPtxAttributeForElement,
  GeneratedPtxAttributeName,
  GeneratedPtxChildElementName,
  GeneratedPtxElementName,
  GeneratedPtxUnmodeledSchemaElementName,
} from './types/generated.js';

export type {
  PtxCuratedElementName,
  PtxSchemaAttributeForElement,
  PtxSchemaAttributeName,
  PtxSchemaChildElementName,
  PtxSchemaChildNode,
  PtxSchemaCustomization,
  PtxSchemaElementName,
  PtxSchemaNode,
  PtxUnmodeledSchemaElementName,
} from './types/schema.js';

export {
  collectPtxSchemaViolations,
  getPtxCuratedElementNames,
  getPtxSchemaAttributeNames,
  getPtxSchemaChildElementNames,
  getPtxSchemaElementNames,
  getPtxUnmodeledSchemaElementNames,
  isPtxCuratedElementName,
  isPtxSchemaElementName,
} from './types/schema.js';

export * from './lib/guards.js';
export * from './lib/builders.js';
