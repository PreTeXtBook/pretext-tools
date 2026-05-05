/**
 * Type guards for ptxast (xast-style) nodes.
 *
 * All guards check `node.type === 'element' && node.name === '<tagname>'`,
 * which is the standard xast node discrimination pattern.
 */

import type { Element, Text, Root } from 'xast';
import type {
  // Document
  Pretext, Book, Article,
  // Front/back
  Frontmatter, Backmatter, Titlepage, Author, Title, Subtitle,
  // Divisions
  Part, Chapter, Section, Subsection, Subsubsection, Paragraphs, Appendix,
  // Theorem-like
  Theorem, Lemma, Corollary, Proposition, Claim, Fact, Conjecture,
  OpenConjecture, OpenProblem, OpenQuestion, Axiom, Principle, Hypothesis,
  // Definition-like
  Definition, Notation,
  // Remark-like
  Remark, Note, Observation, Warning, Insight,
  // Example-like
  Example, Question, Problem, Exercise, Activity, Exploration, Investigation,
  Project, Demonstration, Task,
  // Proof/solution
  Proof, Solution, Answer, Hint, Case, Statement,
  // Other blocks
  Algorithm, Assemblage, Biblio, Listing,
  // Paragraph/block
  P, Blockquote, Pre,
  // Lists
  Ol, Ul, Li, Dl,
  // Figure/media
  Figure, Table, Tabular, Sidebyside, Sbsgroup, Image, Caption, Description,
  // Code
  Program, Console, Sage, Stack, Prompt, Input, Output,
  // Math
  M, Me, Men, Md, Mdn, Mrow,
  // Inline
  Em, Alert, Term, C, Q, Sq, Pubtitle,
  // Refs
  Xref, Url, Fn, Idx, H,
  // Text
  PtxText,
} from '../types/curated.js';

// ---------------------------------------------------------------------------
// Base xast node checks
// ---------------------------------------------------------------------------

/** True if `node` is any xast Element node. */
export function isElement(node: unknown): node is Element {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as Record<string, unknown>)['type'] === 'element' &&
    typeof (node as Record<string, unknown>)['name'] === 'string'
  );
}

/** True if `node` is an xast Parent (Element or Root) with a children array. */
export function isParent(node: unknown): node is Element | Root {
  return isElement(node) || (
    typeof node === 'object' &&
    node !== null &&
    (node as Record<string, unknown>)['type'] === 'root' &&
    Array.isArray((node as Record<string, unknown>)['children'])
  );
}

/** True if `node` is an xast Text node. */
export function isPtxText(node: unknown): node is PtxText {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as Record<string, unknown>)['type'] === 'text' &&
    typeof (node as Record<string, unknown>)['value'] === 'string'
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hasName<T extends string>(name: T) {
  return (node: unknown): node is Element & { name: T } =>
    isElement(node) && (node as Element).name === name;
}

// ---------------------------------------------------------------------------
// Title / Subtitle
// ---------------------------------------------------------------------------

export const isTitle = hasName<'title'>('title') as (node: unknown) => node is Title;
export const isSubtitle = hasName<'subtitle'>('subtitle') as (node: unknown) => node is Subtitle;

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const isPretext = hasName<'pretext'>('pretext') as (node: unknown) => node is Pretext;
export const isBook = hasName<'book'>('book') as (node: unknown) => node is Book;
export const isArticle = hasName<'article'>('article') as (node: unknown) => node is Article;

// ---------------------------------------------------------------------------
// Front/back matter
// ---------------------------------------------------------------------------

export const isFrontmatter = hasName<'frontmatter'>('frontmatter') as (node: unknown) => node is Frontmatter;
export const isBackmatter = hasName<'backmatter'>('backmatter') as (node: unknown) => node is Backmatter;
export const isTitlepage = hasName<'titlepage'>('titlepage') as (node: unknown) => node is Titlepage;
export const isAuthor = hasName<'author'>('author') as (node: unknown) => node is Author;

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

export const isPart = hasName<'part'>('part') as (node: unknown) => node is Part;
export const isChapter = hasName<'chapter'>('chapter') as (node: unknown) => node is Chapter;
export const isSection = hasName<'section'>('section') as (node: unknown) => node is Section;
export const isSubsection = hasName<'subsection'>('subsection') as (node: unknown) => node is Subsection;
export const isSubsubsection = hasName<'subsubsection'>('subsubsection') as (node: unknown) => node is Subsubsection;
export const isParagraphs = hasName<'paragraphs'>('paragraphs') as (node: unknown) => node is Paragraphs;
export const isAppendix = hasName<'appendix'>('appendix') as (node: unknown) => node is Appendix;

// ---------------------------------------------------------------------------
// Theorem-like
// ---------------------------------------------------------------------------

export const isTheorem = hasName<'theorem'>('theorem') as (node: unknown) => node is Theorem;
export const isLemma = hasName<'lemma'>('lemma') as (node: unknown) => node is Lemma;
export const isCorollary = hasName<'corollary'>('corollary') as (node: unknown) => node is Corollary;
export const isProposition = hasName<'proposition'>('proposition') as (node: unknown) => node is Proposition;
export const isClaim = hasName<'claim'>('claim') as (node: unknown) => node is Claim;
export const isFact = hasName<'fact'>('fact') as (node: unknown) => node is Fact;
export const isConjecture = hasName<'conjecture'>('conjecture') as (node: unknown) => node is Conjecture;
export const isOpenConjecture = hasName<'openconjecture'>('openconjecture') as (node: unknown) => node is OpenConjecture;
export const isOpenProblem = hasName<'openproblem'>('openproblem') as (node: unknown) => node is OpenProblem;
export const isOpenQuestion = hasName<'openquestion'>('openquestion') as (node: unknown) => node is OpenQuestion;
export const isAxiom = hasName<'axiom'>('axiom') as (node: unknown) => node is Axiom;
export const isPrinciple = hasName<'principle'>('principle') as (node: unknown) => node is Principle;
export const isHypothesis = hasName<'hypothesis'>('hypothesis') as (node: unknown) => node is Hypothesis;

// ---------------------------------------------------------------------------
// Definition-like
// ---------------------------------------------------------------------------

export const isDefinition = hasName<'definition'>('definition') as (node: unknown) => node is Definition;
export const isNotation = hasName<'notation'>('notation') as (node: unknown) => node is Notation;

// ---------------------------------------------------------------------------
// Remark-like
// ---------------------------------------------------------------------------

export const isRemark = hasName<'remark'>('remark') as (node: unknown) => node is Remark;
export const isNote = hasName<'note'>('note') as (node: unknown) => node is Note;
export const isObservation = hasName<'observation'>('observation') as (node: unknown) => node is Observation;
export const isWarning = hasName<'warning'>('warning') as (node: unknown) => node is Warning;
export const isInsight = hasName<'insight'>('insight') as (node: unknown) => node is Insight;

// ---------------------------------------------------------------------------
// Example-like
// ---------------------------------------------------------------------------

export const isExample = hasName<'example'>('example') as (node: unknown) => node is Example;
export const isQuestion = hasName<'question'>('question') as (node: unknown) => node is Question;
export const isProblem = hasName<'problem'>('problem') as (node: unknown) => node is Problem;
export const isExercise = hasName<'exercise'>('exercise') as (node: unknown) => node is Exercise;
export const isActivity = hasName<'activity'>('activity') as (node: unknown) => node is Activity;
export const isExploration = hasName<'exploration'>('exploration') as (node: unknown) => node is Exploration;
export const isInvestigation = hasName<'investigation'>('investigation') as (node: unknown) => node is Investigation;
export const isProject = hasName<'project'>('project') as (node: unknown) => node is Project;
export const isDemonstration = hasName<'demonstration'>('demonstration') as (node: unknown) => node is Demonstration;
export const isTask = hasName<'task'>('task') as (node: unknown) => node is Task;

// ---------------------------------------------------------------------------
// Proof/solution
// ---------------------------------------------------------------------------

export const isProof = hasName<'proof'>('proof') as (node: unknown) => node is Proof;
export const isSolution = hasName<'solution'>('solution') as (node: unknown) => node is Solution;
export const isAnswer = hasName<'answer'>('answer') as (node: unknown) => node is Answer;
export const isHint = hasName<'hint'>('hint') as (node: unknown) => node is Hint;
export const isCase = hasName<'case'>('case') as (node: unknown) => node is Case;
export const isStatement = hasName<'statement'>('statement') as (node: unknown) => node is Statement;

// ---------------------------------------------------------------------------
// Other block environments
// ---------------------------------------------------------------------------

export const isAlgorithm = hasName<'algorithm'>('algorithm') as (node: unknown) => node is Algorithm;
export const isAssemblage = hasName<'assemblage'>('assemblage') as (node: unknown) => node is Assemblage;
export const isBiblio = hasName<'biblio'>('biblio') as (node: unknown) => node is Biblio;
export const isListing = hasName<'listing'>('listing') as (node: unknown) => node is Listing;

// ---------------------------------------------------------------------------
// Paragraph / block
// ---------------------------------------------------------------------------

export const isP = hasName<'p'>('p') as (node: unknown) => node is P;
export const isBlockquote = hasName<'blockquote'>('blockquote') as (node: unknown) => node is Blockquote;
export const isPre = hasName<'pre'>('pre') as (node: unknown) => node is Pre;

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export const isOl = hasName<'ol'>('ol') as (node: unknown) => node is Ol;
export const isUl = hasName<'ul'>('ul') as (node: unknown) => node is Ul;
export const isLi = hasName<'li'>('li') as (node: unknown) => node is Li;
export const isDl = hasName<'dl'>('dl') as (node: unknown) => node is Dl;

// ---------------------------------------------------------------------------
// Figure / media
// ---------------------------------------------------------------------------

export const isFigure = hasName<'figure'>('figure') as (node: unknown) => node is Figure;
export const isTable = hasName<'table'>('table') as (node: unknown) => node is Table;
export const isTabular = hasName<'tabular'>('tabular') as (node: unknown) => node is Tabular;
export const isSidebyside = hasName<'sidebyside'>('sidebyside') as (node: unknown) => node is Sidebyside;
export const isSbsgroup = hasName<'sbsgroup'>('sbsgroup') as (node: unknown) => node is Sbsgroup;
export const isImage = (node: unknown): node is Image =>
  isElement(node) && ((node as Element).name === 'image');
export const isCaption = hasName<'caption'>('caption') as (node: unknown) => node is Caption;
export const isDescription = hasName<'description'>('description') as (node: unknown) => node is Description;

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------

export const isProgram = hasName<'program'>('program') as (node: unknown) => node is Program;
export const isConsole = hasName<'console'>('console') as (node: unknown) => node is Console;
export const isSage = hasName<'sage'>('sage') as (node: unknown) => node is Sage;
export const isStack = hasName<'stack'>('stack') as (node: unknown) => node is Stack;
export const isPrompt = hasName<'prompt'>('prompt') as (node: unknown) => node is Prompt;
export const isInput = hasName<'input'>('input') as (node: unknown) => node is Input;
export const isOutput = hasName<'output'>('output') as (node: unknown) => node is Output;

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

export const isM = hasName<'m'>('m') as (node: unknown) => node is M;
export const isMe = hasName<'me'>('me') as (node: unknown) => node is Me;
export const isMen = hasName<'men'>('men') as (node: unknown) => node is Men;
export const isMd = hasName<'md'>('md') as (node: unknown) => node is Md;
export const isMdn = hasName<'mdn'>('mdn') as (node: unknown) => node is Mdn;
export const isMrow = hasName<'mrow'>('mrow') as (node: unknown) => node is Mrow;

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

export const isEm = hasName<'em'>('em') as (node: unknown) => node is Em;
export const isAlert = hasName<'alert'>('alert') as (node: unknown) => node is Alert;
export const isTerm = hasName<'term'>('term') as (node: unknown) => node is Term;
export const isC = hasName<'c'>('c') as (node: unknown) => node is C;
export const isQ = hasName<'q'>('q') as (node: unknown) => node is Q;
export const isSq = hasName<'sq'>('sq') as (node: unknown) => node is Sq;
export const isPubtitle = hasName<'pubtitle'>('pubtitle') as (node: unknown) => node is Pubtitle;

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export function isXref(node: unknown): node is Xref {
  return (
    isElement(node) &&
    (node as Element).name === 'xref' &&
    typeof ((node as Element).attributes as Record<string, unknown> | undefined)?.['ref'] === 'string'
  );
}

export const isUrl = hasName<'url'>('url') as (node: unknown) => node is Url;
export const isFn = hasName<'fn'>('fn') as (node: unknown) => node is Fn;
export const isIdx = hasName<'idx'>('idx') as (node: unknown) => node is Idx;
export const isH = hasName<'h'>('h') as (node: unknown) => node is H;
