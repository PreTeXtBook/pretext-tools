/**
 * @pretextbook/ptxast
 *
 * TypeScript type definitions for the PreTeXt Abstract Syntax Tree (ptxast).
 *
 * ptxast is a strongly-typed representation of PreTeXt documents, extending
 * the unist/xast ecosystem patterns. Each significant PreTeXt element gets
 * its own node type with typed children and attributes, rather than using a
 * generic Element with a string `name`.
 *
 * ## Node type naming
 * Every ptxast node has a `type` field using the PreTeXt element name as-is
 * (e.g., `"theorem"`, `"section"`, `"p"`). This matches the XML tag names
 * used in PreTeXt source.
 *
 * ## Content model
 * - `PtxContent` — anything that can appear in a ptxast tree
 * - `PtxBlockContent` — block-level nodes (environments, paragraphs, lists)
 * - `PtxDivisionContent` — division-level nodes (sections, chapters, blocks)
 * - `PtxInlineContent` — inline nodes (text, math, emphasis, cross-refs)
 * - `PtxRoot` — the document root (wraps `<pretext>`)
 *
 * @example
 * ```ts
 * import type { PtxRoot, Section, Theorem } from '@pretextbook/ptxast';
 * ```
 */

export type {
  // Base
  PtxNode,
  PtxData,

  // Shared mixins
  Titled,
  Labeled,

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
  PtxInlineContent,
  PtxMathContent,
} from './types/index.js';

export * from './lib/guards.js';
export * from './lib/builders.js';
