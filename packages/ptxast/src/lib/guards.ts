/**
 * Type guards for ptxast nodes.
 *
 * Each guard narrows an unknown value to the specific ptxast node type.
 * All guards follow the pattern: `is<NodeType>(node: unknown): node is NodeType`.
 */

import type {
  PtxNode,
  PtxContent,
  PtxBlockContent,
  PtxInlineContent,
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
  Ol, Ul, Li, Dl, Di, Dt, Dd,
  // Figure/media
  Figure, Table, Tabular, Sidebyside, Sbsgroup, Image, Caption, Description,
  // Code
  Program, Console, Sage, Stack, Prompt, Input, Output,
  // Math
  M, Me, Men, Md, Mdn, Mrow,
  // Inline
  Em, Alert, Term, C, Q, Sq, Pubtitle, Stitle,
  // Refs
  Xref, Url, Fn, Idx, H,
  // Text
  PtxText,
} from '../types/index.js';

/** Returns true if `node` is any object with a string `type` field. */
export function isPtxNode(node: unknown): node is PtxNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    typeof (node as Record<string, unknown>)['type'] === 'string'
  );
}

/** Returns true if `node` has a `children` array (is a Parent). */
export function isParent(node: unknown): node is PtxNode & { children: unknown[] } {
  return isPtxNode(node) && 'children' in node && Array.isArray((node as Record<string, unknown>)['children']);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Checks type discriminant only — use for union narrowing inside known-valid trees. */
function hasType<T extends string>(type: T) {
  return (node: unknown): node is PtxNode & { type: T } =>
    isPtxNode(node) && (node as PtxNode).type === type;
}

/** Checks type + children array — use for Parent node guards. */
function hasTypeParent<T extends string>(type: T) {
  return (node: unknown): node is PtxNode & { type: T; children: unknown[] } =>
    hasType(type)(node) && Array.isArray((node as unknown as Record<string, unknown>)['children']);
}

/** Checks type + string value — use for Literal node guards (math, code). */
function hasTypeValue<T extends string>(type: T) {
  return (node: unknown): node is PtxNode & { type: T; value: string } =>
    hasType(type)(node) && typeof (node as unknown as Record<string, unknown>)['value'] === 'string';
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export const isPtxText = hasTypeValue<'text'>('text') as (node: unknown) => node is PtxText;

// ---------------------------------------------------------------------------
// Title/Subtitle
// ---------------------------------------------------------------------------

export const isTitle = hasTypeParent<'title'>('title') as (node: unknown) => node is Title;
export const isSubtitle = hasTypeParent<'subtitle'>('subtitle') as (node: unknown) => node is Subtitle;

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const isPretext = hasTypeParent<'pretext'>('pretext') as (node: unknown) => node is Pretext;
export const isBook = hasTypeParent<'book'>('book') as (node: unknown) => node is Book;
export const isArticle = hasTypeParent<'article'>('article') as (node: unknown) => node is Article;

// ---------------------------------------------------------------------------
// Front/back matter
// ---------------------------------------------------------------------------

export const isFrontmatter = hasTypeParent<'frontmatter'>('frontmatter') as (node: unknown) => node is Frontmatter;
export const isBackmatter = hasTypeParent<'backmatter'>('backmatter') as (node: unknown) => node is Backmatter;
export const isTitlepage = hasTypeParent<'titlepage'>('titlepage') as (node: unknown) => node is Titlepage;
export const isAuthor = hasTypeParent<'author'>('author') as (node: unknown) => node is Author;

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

export const isPart = hasTypeParent<'part'>('part') as (node: unknown) => node is Part;
export const isChapter = hasTypeParent<'chapter'>('chapter') as (node: unknown) => node is Chapter;
export const isSection = hasTypeParent<'section'>('section') as (node: unknown) => node is Section;
export const isSubsection = hasTypeParent<'subsection'>('subsection') as (node: unknown) => node is Subsection;
export const isSubsubsection = hasTypeParent<'subsubsection'>('subsubsection') as (node: unknown) => node is Subsubsection;
export const isParagraphs = hasTypeParent<'paragraphs'>('paragraphs') as (node: unknown) => node is Paragraphs;
export const isAppendix = hasTypeParent<'appendix'>('appendix') as (node: unknown) => node is Appendix;

// ---------------------------------------------------------------------------
// Theorem-like
// ---------------------------------------------------------------------------

export const isTheorem = hasTypeParent<'theorem'>('theorem') as (node: unknown) => node is Theorem;
export const isLemma = hasTypeParent<'lemma'>('lemma') as (node: unknown) => node is Lemma;
export const isCorollary = hasTypeParent<'corollary'>('corollary') as (node: unknown) => node is Corollary;
export const isProposition = hasTypeParent<'proposition'>('proposition') as (node: unknown) => node is Proposition;
export const isClaim = hasTypeParent<'claim'>('claim') as (node: unknown) => node is Claim;
export const isFact = hasTypeParent<'fact'>('fact') as (node: unknown) => node is Fact;
export const isConjecture = hasTypeParent<'conjecture'>('conjecture') as (node: unknown) => node is Conjecture;
export const isOpenConjecture = hasTypeParent<'openconjecture'>('openconjecture') as (node: unknown) => node is OpenConjecture;
export const isOpenProblem = hasTypeParent<'openproblem'>('openproblem') as (node: unknown) => node is OpenProblem;
export const isOpenQuestion = hasTypeParent<'openquestion'>('openquestion') as (node: unknown) => node is OpenQuestion;
export const isAxiom = hasTypeParent<'axiom'>('axiom') as (node: unknown) => node is Axiom;
export const isPrinciple = hasTypeParent<'principle'>('principle') as (node: unknown) => node is Principle;
export const isHypothesis = hasTypeParent<'hypothesis'>('hypothesis') as (node: unknown) => node is Hypothesis;

// ---------------------------------------------------------------------------
// Definition-like
// ---------------------------------------------------------------------------

export const isDefinition = hasTypeParent<'definition'>('definition') as (node: unknown) => node is Definition;
export const isNotation = hasTypeParent<'notation'>('notation') as (node: unknown) => node is Notation;

// ---------------------------------------------------------------------------
// Remark-like
// ---------------------------------------------------------------------------

export const isRemark = hasTypeParent<'remark'>('remark') as (node: unknown) => node is Remark;
export const isNote = hasTypeParent<'note'>('note') as (node: unknown) => node is Note;
export const isObservation = hasTypeParent<'observation'>('observation') as (node: unknown) => node is Observation;
export const isWarning = hasTypeParent<'warning'>('warning') as (node: unknown) => node is Warning;
export const isInsight = hasTypeParent<'insight'>('insight') as (node: unknown) => node is Insight;

// ---------------------------------------------------------------------------
// Example-like
// ---------------------------------------------------------------------------

export const isExample = hasTypeParent<'example'>('example') as (node: unknown) => node is Example;
export const isQuestion = hasTypeParent<'question'>('question') as (node: unknown) => node is Question;
export const isProblem = hasTypeParent<'problem'>('problem') as (node: unknown) => node is Problem;
export const isExercise = hasTypeParent<'exercise'>('exercise') as (node: unknown) => node is Exercise;
export const isActivity = hasTypeParent<'activity'>('activity') as (node: unknown) => node is Activity;
export const isExploration = hasTypeParent<'exploration'>('exploration') as (node: unknown) => node is Exploration;
export const isInvestigation = hasTypeParent<'investigation'>('investigation') as (node: unknown) => node is Investigation;
export const isProject = hasTypeParent<'project'>('project') as (node: unknown) => node is Project;
export const isDemonstration = hasTypeParent<'demonstration'>('demonstration') as (node: unknown) => node is Demonstration;
export const isTask = hasTypeParent<'task'>('task') as (node: unknown) => node is Task;

// ---------------------------------------------------------------------------
// Proof/solution
// ---------------------------------------------------------------------------

export const isProof = hasTypeParent<'proof'>('proof') as (node: unknown) => node is Proof;
export const isSolution = hasTypeParent<'solution'>('solution') as (node: unknown) => node is Solution;
export const isAnswer = hasTypeParent<'answer'>('answer') as (node: unknown) => node is Answer;
export const isHint = hasTypeParent<'hint'>('hint') as (node: unknown) => node is Hint;
export const isCase = hasTypeParent<'case'>('case') as (node: unknown) => node is Case;
export const isStatement = hasTypeParent<'statement'>('statement') as (node: unknown) => node is Statement;

// ---------------------------------------------------------------------------
// Other block environments
// ---------------------------------------------------------------------------

export const isAlgorithm = hasTypeParent<'algorithm'>('algorithm') as (node: unknown) => node is Algorithm;
export const isAssemblage = hasTypeParent<'assemblage'>('assemblage') as (node: unknown) => node is Assemblage;
export const isBiblio = hasTypeParent<'biblio'>('biblio') as (node: unknown) => node is Biblio;
export const isListing = hasTypeParent<'listing'>('listing') as (node: unknown) => node is Listing;

// ---------------------------------------------------------------------------
// Paragraph / block
// ---------------------------------------------------------------------------

export const isP = hasTypeParent<'p'>('p') as (node: unknown) => node is P;
export const isBlockquote = hasTypeParent<'blockquote'>('blockquote') as (node: unknown) => node is Blockquote;
export const isPre = hasTypeValue<'pre'>('pre') as (node: unknown) => node is Pre;

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export const isOl = hasTypeParent<'ol'>('ol') as (node: unknown) => node is Ol;
export const isUl = hasTypeParent<'ul'>('ul') as (node: unknown) => node is Ul;
export const isLi = hasTypeParent<'li'>('li') as (node: unknown) => node is Li;
export const isDl = hasTypeParent<'dl'>('dl') as (node: unknown) => node is Dl;
export const isDi = hasTypeParent<'di'>('di') as (node: unknown) => node is Di;
export const isDt = hasTypeParent<'dt'>('dt') as (node: unknown) => node is Dt;
export const isDd = hasTypeParent<'dd'>('dd') as (node: unknown) => node is Dd;

// ---------------------------------------------------------------------------
// Figure / media
// ---------------------------------------------------------------------------

export const isFigure = hasTypeParent<'figure'>('figure') as (node: unknown) => node is Figure;
export const isTable = hasTypeParent<'table'>('table') as (node: unknown) => node is Table;
export const isTabular = hasType<'tabular'>('tabular') as (node: unknown) => node is Tabular;
export const isSidebyside = hasTypeParent<'sidebyside'>('sidebyside') as (node: unknown) => node is Sidebyside;
export const isSbsgroup = hasTypeParent<'sbsgroup'>('sbsgroup') as (node: unknown) => node is Sbsgroup;
export const isImage = hasType<'image'>('image') as (node: unknown) => node is Image;
export const isCaption = hasTypeParent<'caption'>('caption') as (node: unknown) => node is Caption;
export const isDescription = hasTypeParent<'description'>('description') as (node: unknown) => node is Description;

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------

export const isProgram = hasTypeValue<'program'>('program') as (node: unknown) => node is Program;
export const isConsole = hasTypeParent<'console'>('console') as (node: unknown) => node is Console;
export const isSage = hasTypeParent<'sage'>('sage') as (node: unknown) => node is Sage;
export const isStack = hasTypeParent<'stack'>('stack') as (node: unknown) => node is Stack;
export const isPrompt = hasTypeValue<'prompt'>('prompt') as (node: unknown) => node is Prompt;
export const isInput = hasTypeValue<'input'>('input') as (node: unknown) => node is Input;
export const isOutput = hasTypeValue<'output'>('output') as (node: unknown) => node is Output;

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

export const isM = hasTypeValue<'m'>('m') as (node: unknown) => node is M;
export const isMe = hasTypeValue<'me'>('me') as (node: unknown) => node is Me;
export const isMen = hasTypeValue<'men'>('men') as (node: unknown) => node is Men;
export const isMd = hasTypeParent<'md'>('md') as (node: unknown) => node is Md;
export const isMdn = hasTypeParent<'mdn'>('mdn') as (node: unknown) => node is Mdn;
export const isMrow = hasTypeValue<'mrow'>('mrow') as (node: unknown) => node is Mrow;

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

export const isEm = hasTypeParent<'em'>('em') as (node: unknown) => node is Em;
export const isAlert = hasTypeParent<'alert'>('alert') as (node: unknown) => node is Alert;
export const isTerm = hasTypeParent<'term'>('term') as (node: unknown) => node is Term;
export const isC = hasTypeValue<'c'>('c') as (node: unknown) => node is C;
export const isQ = hasTypeParent<'q'>('q') as (node: unknown) => node is Q;
export const isSq = hasTypeParent<'sq'>('sq') as (node: unknown) => node is Sq;
export const isPubtitle = hasTypeParent<'pubtitle'>('pubtitle') as (node: unknown) => node is Pubtitle;
export const isStitle = hasTypeParent<'stitle'>('stitle') as (node: unknown) => node is Stitle;

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** Cross-reference guard — requires `attributes.ref` to be a string. */
export function isXref(node: unknown): node is Xref {
  return (
    isPtxNode(node) &&
    (node as PtxNode).type === 'xref' &&
    typeof ((node as unknown as Record<string, unknown>)['attributes'] as Record<string, unknown> | undefined)?.['ref'] === 'string'
  );
}

export const isUrl = hasType<'url'>('url') as (node: unknown) => node is Url;
export const isFn = hasTypeParent<'fn'>('fn') as (node: unknown) => node is Fn;
export const isIdx = hasTypeParent<'idx'>('idx') as (node: unknown) => node is Idx;
export const isH = hasTypeParent<'h'>('h') as (node: unknown) => node is H;
