/**
 * Core type definitions for ptxast — the PreTeXt Abstract Syntax Tree.
 *
 * Based on the unist/xast ecosystem. Each PreTeXt element has a dedicated
 * interface with typed `children` and `attributes`.
 *
 * Node `type` values match PreTeXt XML tag names exactly.
 */

import type { Data as UnistData, Node as UnistNode, Parent as UnistParent } from 'unist';

// ---------------------------------------------------------------------------
// Base infrastructure
// ---------------------------------------------------------------------------

/** Shared data bag for ptxast nodes (ecosystem extension point). */
export interface PtxData extends UnistData {}

/** Abstract ptxast node — do not use directly. */
export interface PtxNode extends UnistNode {
  data?: PtxData | undefined;
}

/** Abstract ptxast parent — do not use directly. */
export interface PtxParent extends PtxNode {
  children: PtxContent[];
}

/** XML text node (plain character data). */
export interface PtxText extends PtxNode {
  type: 'text';
  value: string;
}

// ---------------------------------------------------------------------------
// Shared attribute mixins
// ---------------------------------------------------------------------------

/** Mixin for nodes that may have an `@xml:id` label. */
export interface Labeled {
  attributes?: { 'xml:id'?: string } & Record<string, string | undefined>;
}

/** Mixin for nodes that optionally carry a `<title>` child. */
export interface Titled {
  // Expressed as a potential first child; not an attribute.
}

// ---------------------------------------------------------------------------
// Title / Subtitle (inline containers)
// ---------------------------------------------------------------------------

export interface Title extends PtxParent {
  type: 'title';
  children: PtxInlineContent[];
}

export interface Subtitle extends PtxParent {
  type: 'subtitle';
  children: PtxInlineContent[];
}

// ---------------------------------------------------------------------------
// Document-level
// ---------------------------------------------------------------------------

/**
 * Root document node — used as the output of transformers (a document
 * fragment). Children are intentionally broad so that parsers and transformers
 * can place any ptxast content here without wrapping in a full Pretext tree.
 */
export interface PtxRoot extends PtxParent {
  type: 'root';
  children: PtxContent[];
}

export interface Pretext extends PtxParent {
  type: 'pretext';
  attributes?: { 'xml:lang'?: string; 'xml:base'?: string } & Record<string, string | undefined>;
  children: (Book | Article)[];
}

export interface Book extends PtxParent {
  type: 'book';
  attributes?: { 'xml:id'?: string } & Record<string, string | undefined>;
  children: (Frontmatter | Part | Chapter | Backmatter | Title | Subtitle)[];
}

export interface Article extends PtxParent {
  type: 'article';
  attributes?: { 'xml:id'?: string } & Record<string, string | undefined>;
  children: (Frontmatter | Section | Backmatter | Title | Subtitle)[];
}

// ---------------------------------------------------------------------------
// Front / back matter
// ---------------------------------------------------------------------------

export interface Frontmatter extends PtxParent {
  type: 'frontmatter';
  children: (Titlepage | PtxBlockContent | Title)[];
}

export interface Backmatter extends PtxParent {
  type: 'backmatter';
  children: (Appendix | PtxBlockContent | Title)[];
}

export interface Titlepage extends PtxParent {
  type: 'titlepage';
  children: (Author | Title | Subtitle | PtxText)[];
}

export interface Author extends PtxParent {
  type: 'author';
  children: (PtxInlineContent | PtxText)[];
}

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

/** Attributes common to all division nodes. */
interface DivisionAttributes {
  'xml:id'?: string;
  'xmlns'?: string;
}

export interface Part extends PtxParent {
  type: 'part';
  attributes?: DivisionAttributes & Record<string, string | undefined>;
  children: (Chapter | Frontmatter | Backmatter | Title)[];
}

export interface Chapter extends PtxParent {
  type: 'chapter';
  attributes?: DivisionAttributes & Record<string, string | undefined>;
  children: (Section | PtxBlockContent | Title)[];
}

export interface Section extends PtxParent {
  type: 'section';
  attributes?: DivisionAttributes & Record<string, string | undefined>;
  children: (Subsection | PtxBlockContent | Title)[];
}

export interface Subsection extends PtxParent {
  type: 'subsection';
  attributes?: DivisionAttributes & Record<string, string | undefined>;
  children: (Subsubsection | PtxBlockContent | Title)[];
}

export interface Subsubsection extends PtxParent {
  type: 'subsubsection';
  attributes?: DivisionAttributes & Record<string, string | undefined>;
  children: (Paragraphs | PtxBlockContent | Title)[];
}

export interface Paragraphs extends PtxParent {
  type: 'paragraphs';
  attributes?: DivisionAttributes & Record<string, string | undefined>;
  children: (PtxBlockContent | Title)[];
}

export interface Appendix extends PtxParent {
  type: 'appendix';
  attributes?: DivisionAttributes & Record<string, string | undefined>;
  children: (Section | PtxBlockContent | Title)[];
}

/** All division-level nodes. */
export type PtxDivisionContent =
  | Part
  | Chapter
  | Section
  | Subsection
  | Subsubsection
  | Paragraphs
  | Appendix;

// ---------------------------------------------------------------------------
// Shared block-environment attributes
// ---------------------------------------------------------------------------

interface BlockEnvAttributes {
  'xml:id'?: string;
  permid?: string;
}

// ---------------------------------------------------------------------------
// Theorem-like environments (have Statement + optional Proof)
// ---------------------------------------------------------------------------

/** Content allowed inside a `<statement>` block. */
export interface Statement extends PtxParent {
  type: 'statement';
  children: PtxBlockContent[];
}

type TheoremLikeChildren = (Title | Statement | Proof | PtxBlockContent)[];
type TheoremLikeAttributes = BlockEnvAttributes & Record<string, string | undefined>;

export interface Theorem extends PtxParent {
  type: 'theorem';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Lemma extends PtxParent {
  type: 'lemma';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Corollary extends PtxParent {
  type: 'corollary';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Proposition extends PtxParent {
  type: 'proposition';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Claim extends PtxParent {
  type: 'claim';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Fact extends PtxParent {
  type: 'fact';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Conjecture extends PtxParent {
  type: 'conjecture';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface OpenConjecture extends PtxParent {
  type: 'openconjecture';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface OpenProblem extends PtxParent {
  type: 'openproblem';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface OpenQuestion extends PtxParent {
  type: 'openquestion';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Axiom extends PtxParent {
  type: 'axiom';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Principle extends PtxParent {
  type: 'principle';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Hypothesis extends PtxParent {
  type: 'hypothesis';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

// ---------------------------------------------------------------------------
// Definition-like environments
// ---------------------------------------------------------------------------

export interface Definition extends PtxParent {
  type: 'definition';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Notation extends PtxParent {
  type: 'notation';
  attributes?: TheoremLikeAttributes;
  children: (Title | Statement | PtxBlockContent)[];
}

// ---------------------------------------------------------------------------
// Remark-like environments (no proof; just block content)
// ---------------------------------------------------------------------------

type RemarkLikeChildren = (Title | PtxBlockContent)[];
type RemarkLikeAttributes = BlockEnvAttributes & Record<string, string | undefined>;

export interface Remark extends PtxParent {
  type: 'remark';
  attributes?: RemarkLikeAttributes;
  children: RemarkLikeChildren;
}

export interface Note extends PtxParent {
  type: 'note';
  attributes?: RemarkLikeAttributes;
  children: RemarkLikeChildren;
}

export interface Observation extends PtxParent {
  type: 'observation';
  attributes?: RemarkLikeAttributes;
  children: RemarkLikeChildren;
}

export interface Warning extends PtxParent {
  type: 'warning';
  attributes?: RemarkLikeAttributes;
  children: RemarkLikeChildren;
}

export interface Insight extends PtxParent {
  type: 'insight';
  attributes?: RemarkLikeAttributes;
  children: RemarkLikeChildren;
}

// ---------------------------------------------------------------------------
// Example-like environments (contain tasks/solutions)
// ---------------------------------------------------------------------------

type ExampleLikeChildren = (Title | P | Blockquote | Ol | Ul | Task | Solution | Hint | Answer | PtxBlockContent)[];
type ExampleLikeAttributes = BlockEnvAttributes & Record<string, string | undefined>;

export interface Example extends PtxParent {
  type: 'example';
  attributes?: ExampleLikeAttributes;
  children: ExampleLikeChildren;
}

export interface Question extends PtxParent {
  type: 'question';
  attributes?: ExampleLikeAttributes;
  children: ExampleLikeChildren;
}

export interface Problem extends PtxParent {
  type: 'problem';
  attributes?: ExampleLikeAttributes;
  children: ExampleLikeChildren;
}

export interface Exercise extends PtxParent {
  type: 'exercise';
  attributes?: ExampleLikeAttributes;
  children: ExampleLikeChildren;
}

export interface Activity extends PtxParent {
  type: 'activity';
  attributes?: ExampleLikeAttributes;
  children: ExampleLikeChildren;
}

export interface Exploration extends PtxParent {
  type: 'exploration';
  attributes?: ExampleLikeAttributes;
  children: ExampleLikeChildren;
}

export interface Investigation extends PtxParent {
  type: 'investigation';
  attributes?: ExampleLikeAttributes;
  children: ExampleLikeChildren;
}

export interface Project extends PtxParent {
  type: 'project';
  attributes?: ExampleLikeAttributes;
  children: ExampleLikeChildren;
}

export interface Demonstration extends PtxParent {
  type: 'demonstration';
  attributes?: ExampleLikeAttributes;
  children: ExampleLikeChildren;
}

/** A sub-task inside an example-like environment. */
export interface Task extends PtxParent {
  type: 'task';
  attributes?: ExampleLikeAttributes;
  children: (Title | P | Ol | Ul | Solution | Hint | Answer | Task)[];
}

// ---------------------------------------------------------------------------
// Proof / solution-like environments
// ---------------------------------------------------------------------------

export interface Proof extends PtxParent {
  type: 'proof';
  attributes?: BlockEnvAttributes & Record<string, string | undefined>;
  children: (Title | PtxBlockContent)[];
}

export interface Solution extends PtxParent {
  type: 'solution';
  attributes?: BlockEnvAttributes & Record<string, string | undefined>;
  children: (Title | PtxBlockContent)[];
}

export interface Answer extends PtxParent {
  type: 'answer';
  attributes?: BlockEnvAttributes & Record<string, string | undefined>;
  children: (Title | PtxBlockContent)[];
}

export interface Hint extends PtxParent {
  type: 'hint';
  attributes?: BlockEnvAttributes & Record<string, string | undefined>;
  children: (Title | PtxBlockContent)[];
}

/** A case inside a proof. */
export interface Case extends PtxParent {
  type: 'case';
  attributes?: BlockEnvAttributes & Record<string, string | undefined>;
  children: (Title | PtxBlockContent)[];
}

// ---------------------------------------------------------------------------
// Other block environments
// ---------------------------------------------------------------------------

export interface Algorithm extends PtxParent {
  type: 'algorithm';
  attributes?: TheoremLikeAttributes;
  children: TheoremLikeChildren;
}

export interface Assemblage extends PtxParent {
  type: 'assemblage';
  attributes?: TheoremLikeAttributes;
  children: (Title | PtxBlockContent)[];
}

export interface Biblio extends PtxParent {
  type: 'biblio';
  attributes?: { 'xml:id'?: string; type?: string } & Record<string, string | undefined>;
  children: PtxInlineContent[];
}

export interface Listing extends PtxParent {
  type: 'listing';
  attributes?: BlockEnvAttributes & Record<string, string | undefined>;
  children: (Title | Caption | Program | Console | Pre)[];
}

// ---------------------------------------------------------------------------
// Paragraph and block-level
// ---------------------------------------------------------------------------

export interface P extends PtxParent {
  type: 'p';
  attributes?: { 'xml:id'?: string } & Record<string, string | undefined>;
  children: PtxInlineContent[];
}

export interface Blockquote extends PtxParent {
  type: 'blockquote';
  children: P[];
}

export interface Pre extends PtxNode {
  type: 'pre';
  value: string;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export interface Ol extends PtxParent {
  type: 'ol';
  attributes?: { cols?: string; marker?: string } & Record<string, string | undefined>;
  children: Li[];
}

export interface Ul extends PtxParent {
  type: 'ul';
  attributes?: { cols?: string } & Record<string, string | undefined>;
  children: Li[];
}

export interface Li extends PtxParent {
  type: 'li';
  attributes?: { 'xml:id'?: string } & Record<string, string | undefined>;
  children: PtxBlockContent[];
}

export interface Dl extends PtxParent {
  type: 'dl';
  children: Di[];
}

/** A `<di>` description list item (contains `<dt>` and `<dd>`). */
export interface Di extends PtxParent {
  type: 'di';
  children: (Dt | Dd)[];
}

export interface Dt extends PtxParent {
  type: 'dt';
  children: PtxInlineContent[];
}

export interface Dd extends PtxParent {
  type: 'dd';
  children: (P | PtxInlineContent)[];
}

// ---------------------------------------------------------------------------
// Figure, table, media
// ---------------------------------------------------------------------------

export interface Figure extends PtxParent {
  type: 'figure';
  attributes?: { 'xml:id'?: string } & Record<string, string | undefined>;
  children: (Caption | Image | Sidebyside | Sbsgroup | Table | Program | Pre)[];
}

export interface Table extends PtxParent {
  type: 'table';
  attributes?: { 'xml:id'?: string } & Record<string, string | undefined>;
  children: (Caption | Tabular)[];
}

/** Placeholder for `<tabular>` — fully typed tabular is future work. */
export interface Tabular extends PtxNode {
  type: 'tabular';
  attributes?: Record<string, string | undefined>;
  children: PtxContent[];
}

export interface Sidebyside extends PtxParent {
  type: 'sidebyside';
  attributes?: { widths?: string; margins?: string; valign?: string } & Record<string, string | undefined>;
  children: (P | Image | Program | Pre | Table | Figure)[];
}

export interface Sbsgroup extends PtxParent {
  type: 'sbsgroup';
  children: Sidebyside[];
}

export interface Image extends PtxNode {
  type: 'image';
  attributes?: { source?: string; width?: string; 'xml:id'?: string } & Record<string, string | undefined>;
  children?: (Description | PtxText)[];
}

export interface Caption extends PtxParent {
  type: 'caption';
  children: PtxInlineContent[];
}

export interface Description extends PtxParent {
  type: 'description';
  children: PtxInlineContent[];
}

// ---------------------------------------------------------------------------
// Code / program / console
// ---------------------------------------------------------------------------

export interface Program extends PtxNode {
  type: 'program';
  attributes?: { language?: string; 'xml:id'?: string } & Record<string, string | undefined>;
  value: string;
}

export interface Console extends PtxParent {
  type: 'console';
  children: (Prompt | Input | Output)[];
}

export interface Prompt extends PtxNode {
  type: 'prompt';
  value: string;
}

export interface Input extends PtxNode {
  type: 'input';
  value: string;
}

export interface Output extends PtxNode {
  type: 'output';
  value: string;
}

export interface Sage extends PtxParent {
  type: 'sage';
  attributes?: { language?: string } & Record<string, string | undefined>;
  children: (Input | Output)[];
}

export interface Stack extends PtxParent {
  type: 'stack';
  children: (P | Image | Program | Pre)[];
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

/** Inline math: `<m>content</m>`. */
export interface M extends PtxNode {
  type: 'm';
  value: string;
}

/** Display math (unnumbered): `<me>content</me>`. */
export interface Me extends PtxNode {
  type: 'me';
  value: string;
}

/** Display math (numbered): `<men xml:id="...">content</men>`. */
export interface Men extends PtxNode {
  type: 'men';
  attributes?: { 'xml:id'?: string; tag?: string } & Record<string, string | undefined>;
  value: string;
}

/** Multi-line display math (unnumbered): `<md>`. */
export interface Md extends PtxParent {
  type: 'md';
  children: Mrow[];
}

/** Multi-line display math (numbered): `<mdn>`. */
export interface Mdn extends PtxParent {
  type: 'mdn';
  children: Mrow[];
}

/** A row in `<md>` or `<mdn>`. */
export interface Mrow extends PtxNode {
  type: 'mrow';
  attributes?: { 'xml:id'?: string; tag?: string; number?: string } & Record<string, string | undefined>;
  value: string;
}

export type PtxMathContent = M | Me | Men | Md | Mdn;

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

export interface Em extends PtxParent {
  type: 'em';
  children: PtxInlineContent[];
}

export interface Alert extends PtxParent {
  type: 'alert';
  children: PtxInlineContent[];
}

export interface Term extends PtxParent {
  type: 'term';
  children: PtxInlineContent[];
}

/** Inline code: `<c>`. */
export interface C extends PtxNode {
  type: 'c';
  value: string;
}

/** Quotation: `<q>`. */
export interface Q extends PtxParent {
  type: 'q';
  children: PtxInlineContent[];
}

/** Single quotation: `<sq>`. */
export interface Sq extends PtxParent {
  type: 'sq';
  children: PtxInlineContent[];
}

/** Publication title: `<pubtitle>`. */
export interface Pubtitle extends PtxParent {
  type: 'pubtitle';
  children: PtxInlineContent[];
}

/** Section/chapter title reference: `<stitle>`. */
export interface Stitle extends PtxParent {
  type: 'stitle';
  children: PtxInlineContent[];
}

// ---------------------------------------------------------------------------
// References and links
// ---------------------------------------------------------------------------

export interface Xref extends PtxNode {
  type: 'xref';
  attributes: { ref: string; text?: string } & Record<string, string | undefined>;
}

export interface Url extends PtxNode {
  type: 'url';
  attributes: { href: string; visual?: string } & Record<string, string | undefined>;
}

export interface Fn extends PtxParent {
  type: 'fn';
  children: P[];
}

export interface Idx extends PtxParent {
  type: 'idx';
  children: (H | PtxText)[];
}

/** `<h>` inside `<idx>`. */
export interface H extends PtxParent {
  type: 'h';
  children: PtxInlineContent[];
}

// ---------------------------------------------------------------------------
// Content union types
// ---------------------------------------------------------------------------

/** All inline content nodes. */
export type PtxInlineContent =
  | PtxText
  | Em
  | Alert
  | Term
  | C
  | Q
  | Sq
  | Pubtitle
  | Stitle
  | M
  | Xref
  | Url
  | Fn
  | Idx;

/** All block-level content nodes. */
export type PtxBlockContent =
  | P
  | Blockquote
  | Pre
  | Ol
  | Ul
  | Dl
  | Figure
  | Table
  | Sidebyside
  | Sbsgroup
  | Image
  | Program
  | Console
  | Sage
  | Stack
  | Listing
  | Me
  | Men
  | Md
  | Mdn
  | Theorem
  | Lemma
  | Corollary
  | Proposition
  | Claim
  | Fact
  | Conjecture
  | OpenConjecture
  | OpenProblem
  | OpenQuestion
  | Axiom
  | Principle
  | Hypothesis
  | Definition
  | Notation
  | Remark
  | Note
  | Observation
  | Warning
  | Insight
  | Example
  | Question
  | Problem
  | Exercise
  | Activity
  | Exploration
  | Investigation
  | Project
  | Demonstration
  | Proof
  | Solution
  | Answer
  | Hint
  | Case
  | Algorithm
  | Assemblage
  | Biblio
  | Statement
  | Task;

/** All content nodes (inline + block + structural). */
export type PtxContent =
  | PtxBlockContent
  | PtxInlineContent
  | PtxDivisionContent
  | Title
  | Subtitle
  | Titlepage
  | Author
  | Frontmatter
  | Backmatter
  | Book
  | Article
  | Pretext
  | Tabular
  | Caption
  | Description
  | Prompt
  | Input
  | Output
  | Mrow
  | Di
  | Dt
  | Dd
  | H
  | Li;
