/**
 * Curated layer for @pretextbook/ptxast — typed xast PreTeXt nodes.
 *
 * This file provides:
 * - `PtxRoot` — alias for xast `Root`
 * - Type aliases and unions for the ~92 most-used PreTeXt elements
 * - Semantic union types (PtxDivisionElement, PtxBlockElement, etc.)
 * - `getPtxTextContent` — extract text from value-child elements (math, code)
 *
 * All node shapes follow xast conventions:
 *   { type: 'element', name: 'section', attributes: {...}, children: [...] }
 */

import type { Root, Element, Text, ElementContent } from 'xast';
import type {
  // Document level
  ElementPretextRoot,
  ElementPretext,
  ElementBook,
  ElementArticle,
  // Front/back matter
  ElementBookFrontMatter,
  ElementArticleFrontMatter,
  ElementBookBackMatter,
  ElementArticleBackMatter,
  ElementTitlePage,
  // Divisions
  ElementPart,
  ElementChapter,
  ElementSection,
  ElementParagraphs,
  ElementParagraphsNoNumber,
  ElementBookAppendix,
  ElementArticleAppendix,
  // Titles
  ElementTitle,
  ElementLinedTitle,
  ElementBibTitle,
  ElementSubtitle,
  ElementLinedSubtitle,
  // Author
  ElementAuthorByline,
  ElementAuthor,
  ElementBibAuthor,
  ElementPoemAuthor,
  // Theorem-like
  ElementTheorem,
  ElementLemma,
  ElementCorollary,
  ElementProposition,
  ElementClaim,
  ElementFact,
  ElementConjecture,
  ElementAxiom,
  ElementPrinciple,
  ElementHypothesis,
  // Definition-like
  ElementDefinition,
  ElementNotation,
  // Remark-like
  ElementRemark,
  ElementObservation,
  ElementWarning,
  ElementInsight,
  ElementNote,
  ElementBibNote,
  // Example-like
  ElementExample,
  ElementQuestion,
  ElementProblem,
  ElementProject,
  ElementExploration,
  ElementInvestigation,
  ElementActivity,
  // Proof / solution-like
  ElementProof,
  ElementProof1,
  ElementStatement,
  ElementStatementExercise,
  ElementStatementExerciseWW,
  ElementStatement2,
  ElementSolution,
  ElementSolutionWW,
  ElementHint,
  ElementHintWW,
  ElementAnswer,
  ElementCase,
  // Other blocks
  ElementAlgorithm,
  ElementAssemblage,
  ElementBibliographyItem,
  ElementListing,
  ElementTask,
  ElementTaskWW,
  // Paragraph / blocks
  ElementParagraph,
  ElementParagraphAreas,
  ElementParagraphLined,
  ElementBlockQuote,
  ElementPreformatted,
  // Lists
  ElementOl,
  ElementExerciseOrderedList,
  ElementUl,
  ElementListItem,
  ElementDefinitionListItem,
  ElementExerciseListItem,
  ElementDl,
  // Figure / table / media
  ElementFigure,
  ElementFigure1,
  ElementFigure2,
  ElementTable,
  ElementTabular,
  ElementSidebyside,
  ElementSidebyside1,
  ElementSidebyside2,
  ElementSidebyside3,
  ElementSideBySideGroup,
  ElementSideBySideGroupNoCaption,
  ElementImageRaster,
  ElementImageCode,
  ElementCaption,
  ElementImageDescription,
  // Program / code
  ElementProgram,
  ElementConsole,
  ElementSage,
  ElementStack,
  ElementStack1,
  ElementPrompt,
  ElementInput,
  ElementConsoleInput,
  ElementSageInput,
  ElementOutput,
  ElementConsoleOutput,
  ElementSageOutput,
  // Math
  ElementMathInline,
  ElementMe,
  ElementMe1,
  ElementMen,
  ElementMen1,
  ElementMd,
  ElementMd1,
  ElementMdn,
  ElementMdn1,
  ElementMathRow,
  // Inline
  ElementEm,
  ElementAlert,
  ElementTerm,
  ElementC,
  ElementQ,
  ElementQ1,
  ElementSq,
  ElementSq1,
  ElementPubtitle,
  // References
  ElementXref,
  ElementUrl,
  ElementFootnote,
  ElementIndex,
  ElementIdxHeading,
} from './generated-interfaces.js';

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

/** Document root — use xast Root directly. */
export type PtxRoot = Root;
// Re-export core xast types so consumers don't need to import the xast package directly
export type { Root, Element, Text, ElementContent };

// ---------------------------------------------------------------------------
// Document-level aliases
// ---------------------------------------------------------------------------

export type Pretext = ElementPretextRoot | ElementPretext;
export type Book = ElementBook;
export type Article = ElementArticle;

// ---------------------------------------------------------------------------
// Front/back matter
// ---------------------------------------------------------------------------

export type Frontmatter = ElementBookFrontMatter | ElementArticleFrontMatter;
export type Backmatter = ElementBookBackMatter | ElementArticleBackMatter;
export type Titlepage = ElementTitlePage;
export type Author = ElementAuthorByline | ElementAuthor | ElementBibAuthor | ElementPoemAuthor;

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

export type Part = ElementPart;
export type Chapter = ElementChapter;
export type Section = ElementSection;
export type Paragraphs = ElementParagraphs | ElementParagraphsNoNumber;
export type Appendix = ElementBookAppendix | ElementArticleAppendix;

// No Subsection/Subsubsection in generated schema — define as Element
export type Subsection = Element & { name: 'subsection' };
export type Subsubsection = Element & { name: 'subsubsection' };

// ---------------------------------------------------------------------------
// Title / Subtitle
// ---------------------------------------------------------------------------

export type Title = ElementTitle | ElementLinedTitle | ElementBibTitle;
export type Subtitle = ElementSubtitle | ElementLinedSubtitle;

// ---------------------------------------------------------------------------
// Theorem-like
// ---------------------------------------------------------------------------

export type Theorem = ElementTheorem;
export type Lemma = ElementLemma;
export type Corollary = ElementCorollary;
export type Proposition = ElementProposition;
export type Claim = ElementClaim;
export type Fact = ElementFact;
export type Conjecture = ElementConjecture;
export type OpenConjecture = Element & { name: 'openconjecture' };
export type OpenProblem = Element & { name: 'openproblem' };
export type OpenQuestion = Element & { name: 'openquestion' };
export type Axiom = ElementAxiom;
export type Principle = ElementPrinciple;
export type Hypothesis = ElementHypothesis;

// ---------------------------------------------------------------------------
// Definition-like
// ---------------------------------------------------------------------------

export type Definition = ElementDefinition;
export type Notation = ElementNotation;

// ---------------------------------------------------------------------------
// Remark-like
// ---------------------------------------------------------------------------

export type Remark = ElementRemark;
export type Note = ElementNote | ElementBibNote;
export type Observation = ElementObservation;
export type Warning = ElementWarning;
export type Insight = ElementInsight;

// ---------------------------------------------------------------------------
// Example-like
// ---------------------------------------------------------------------------

export type Example = ElementExample;
export type Question = ElementQuestion;
export type Problem = ElementProblem;
export type Exercise = Element & { name: 'exercise' };
export type Activity = ElementActivity;
export type Exploration = ElementExploration;
export type Investigation = ElementInvestigation;
export type Project = ElementProject;
export type Demonstration = Element & { name: 'demonstration' };
export type Task = ElementTask | ElementTaskWW;

// ---------------------------------------------------------------------------
// Proof / solution-like
// ---------------------------------------------------------------------------

export type Proof = ElementProof | ElementProof1;
export type Statement = ElementStatement | ElementStatementExercise | ElementStatementExerciseWW | ElementStatement2;
export type Solution = ElementSolution | ElementSolutionWW;
export type Hint = ElementHint | ElementHintWW;
export type Answer = ElementAnswer;
export type Case = ElementCase;

// ---------------------------------------------------------------------------
// Other block environments
// ---------------------------------------------------------------------------

export type Algorithm = ElementAlgorithm;
export type Assemblage = ElementAssemblage;
export type Biblio = ElementBibliographyItem;
export type Listing = ElementListing;

// ---------------------------------------------------------------------------
// Paragraphs and block-level
// ---------------------------------------------------------------------------

export type P = ElementParagraph | ElementParagraphAreas | ElementParagraphLined;
export type Blockquote = ElementBlockQuote;
export type Pre = ElementPreformatted;

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type Ol = ElementOl | ElementExerciseOrderedList;
export type Ul = ElementUl;
export type Li = ElementListItem | ElementDefinitionListItem | ElementExerciseListItem;
export type Dl = ElementDl;
/** PreTeXt description list items use `<li>` inside `<dl>`, not di/dt/dd */
export type Di = Li;
export type Dt = Element & { name: 'dt' };
export type Dd = Element & { name: 'dd' };

// ---------------------------------------------------------------------------
// Figure / table / media
// ---------------------------------------------------------------------------

export type Figure = ElementFigure | ElementFigure1 | ElementFigure2;
export type Table = ElementTable;
export type Tabular = ElementTabular;
export type Sidebyside = ElementSidebyside | ElementSidebyside1 | ElementSidebyside2 | ElementSidebyside3;
export type Sbsgroup = ElementSideBySideGroup | ElementSideBySideGroupNoCaption;
export type Image = ElementImageRaster | ElementImageCode;
export type Caption = ElementCaption;
export type Description = ElementImageDescription;

// ---------------------------------------------------------------------------
// Code / program / console
// ---------------------------------------------------------------------------

export type Program = ElementProgram;
export type Console = ElementConsole;
export type Sage = ElementSage;
export type Stack = ElementStack | ElementStack1;
export type Prompt = ElementPrompt;
export type Input = ElementInput | ElementConsoleInput | ElementSageInput;
export type Output = ElementOutput | ElementConsoleOutput | ElementSageOutput;

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

/** Inline math: `<m>` */
export type M = ElementMathInline;
/** Display math (unnumbered): `<me>` */
export type Me = ElementMe | ElementMe1;
/** Display math (numbered): `<men>` */
export type Men = ElementMen | ElementMen1;
/** Multi-line display math (unnumbered): `<md>` */
export type Md = ElementMd | ElementMd1;
/** Multi-line display math (numbered): `<mdn>` */
export type Mdn = ElementMdn | ElementMdn1;
/** Row in md/mdn: `<mrow>` */
export type Mrow = ElementMathRow;

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

export type Em = ElementEm;
export type Alert = ElementAlert;
export type Term = ElementTerm;
/** Inline code: `<c>` */
export type C = ElementC;
export type Q = ElementQ | ElementQ1;
export type Sq = ElementSq | ElementSq1;
export type Pubtitle = ElementPubtitle;
/** Section/chapter title reference: `<stitle>` (not in schema, custom extension) */
export type Stitle = Element & { name: 'stitle' };

// ---------------------------------------------------------------------------
// References and links
// ---------------------------------------------------------------------------

export type Xref = ElementXref;
export type Url = ElementUrl;
export type Fn = ElementFootnote;
export type Idx = ElementIndex;
/** `<h>` heading inside `<idx>` */
export type H = ElementIdxHeading;

// ---------------------------------------------------------------------------
// Text node
// ---------------------------------------------------------------------------

/** Plain text node — xast Text unchanged. */
export type PtxText = Text;

// ---------------------------------------------------------------------------
// Semantic union types
// ---------------------------------------------------------------------------

export type PtxDivisionElement =
  | Part
  | Chapter
  | Section
  | Subsection
  | Subsubsection
  | Paragraphs
  | Appendix;

export type PtxTheoremLikeElement =
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
  | Hypothesis;

export type PtxMathContent = M | Me | Men | Md | Mdn;

export type PtxBlockElement =
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

/** Old name kept for compatibility. */
export type PtxBlockContent = PtxBlockElement;
/** Old name kept for compatibility. */
export type PtxDivisionContent = PtxDivisionElement;

export type PtxInlineElement =
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
  | Me
  | Md
  | Men
  | Mdn
  | Xref
  | Url
  | Fn
  | Idx;

/** Old name kept for compatibility. */
export type PtxInlineContent = PtxInlineElement;

export type PtxAllElement =
  | PtxBlockElement
  | PtxInlineElement
  | PtxDivisionElement
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
  | Li;

/** Old name kept for compatibility. */
export type PtxContent = PtxAllElement;

// ---------------------------------------------------------------------------
// Value element text extraction
// ---------------------------------------------------------------------------

/**
 * Names of PreTeXt elements that hold raw text as a single Text child.
 * In xast these are elements whose meaningful content is their text.
 */
export const PTX_VALUE_ELEMENT_NAMES = new Set([
  'm', 'me', 'men', 'mrow', 'c', 'pre', 'cline',
  'input', 'output', 'prompt',
]);

/**
 * Extract the text content of a value-child element (e.g., `<m>`, `<c>`, `<pre>`).
 * Concatenates all Text child node values.
 */
export function getPtxTextContent(el: Element): string {
  if (!('children' in el) || !Array.isArray(el.children)) return '';
  return el.children
    .filter((c): c is Text => c.type === 'text')
    .map((c) => c.value)
    .join('');
}
