/**
 * Builder functions for ptxast nodes.
 *
 * These are convenience factories — analogous to `xastscript` but
 * PreTeXt-aware. Each function returns a fully typed ptxast node.
 *
 * Only the most commonly-needed builders are provided here. Create nodes
 * directly when these don't suffice (the types are all exported from
 * `@pretextbook/ptxast`).
 *
 * @example
 * ```ts
 * import { section, theorem, proof, p, text, m } from '@pretextbook/ptxast';
 *
 * const tree = section(
 *   [theorem([p([text('For all '), m('n'), text(', we have...')])], { 'xml:id': 'thm-main' })],
 *   { 'xml:id': 'sec-intro' }
 * );
 * ```
 */

import type {
  PtxText,
  Title,
  P,
  Em,
  Alert,
  Term,
  C,
  Q,
  M,
  Me,
  Men,
  Xref,
  Url,
  Fn,
  Section,
  Subsection,
  Chapter,
  Theorem,
  Lemma,
  Corollary,
  Proposition,
  Definition,
  Remark,
  Note,
  Warning,
  Example,
  Exercise,
  Proof,
  Solution,
  Hint,
  Answer,
  Statement,
  Assemblage,
  Ol,
  Ul,
  Li,
  PtxBlockContent,
  PtxInlineContent,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Text node
// ---------------------------------------------------------------------------

/** Create a plain text node. */
export function text(value: string): PtxText {
  return { type: 'text', value };
}

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

export function title(children: PtxInlineContent[]): Title {
  return { type: 'title', children };
}

export function em(children: PtxInlineContent[]): Em {
  return { type: 'em', children };
}

export function alert(children: PtxInlineContent[]): Alert {
  return { type: 'alert', children };
}

export function term(children: PtxInlineContent[]): Term {
  return { type: 'term', children };
}

export function c(value: string): C {
  return { type: 'c', value };
}

export function q(children: PtxInlineContent[]): Q {
  return { type: 'q', children };
}

/** Inline math. */
export function m(value: string): M {
  return { type: 'm', value };
}

/** Display math (unnumbered). */
export function me(value: string): Me {
  return { type: 'me', value };
}

/** Display math (numbered). */
export function men(value: string, attrs?: Men['attributes']): Men {
  const node: Men = { type: 'men', value };
  if (attrs) node.attributes = attrs;
  return node;
}

/** Cross-reference. `ref` is always set last so it cannot be overridden by `extraAttrs`. */
export function xref(ref: string, extraAttrs?: Omit<Record<string, string | undefined>, 'ref'>): Xref {
  return { type: 'xref', attributes: { ...extraAttrs, ref } };
}

/** External URL. */
export function url(href: string, visual?: string): Url {
  return { type: 'url', attributes: { href, ...(visual ? { visual } : {}) } };
}

/** Footnote. */
export function fn(children: P[]): Fn {
  return { type: 'fn', children };
}

// ---------------------------------------------------------------------------
// Paragraph
// ---------------------------------------------------------------------------

export function p(
  children: PtxInlineContent[],
  attrs?: P['attributes'],
): P {
  const node: P = { type: 'p', children };
  if (attrs) node.attributes = attrs;
  return node;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function li(children: PtxBlockContent[]): Li {
  return { type: 'li', children };
}

export function ol(items: Li[], attrs?: Ol['attributes']): Ol {
  const node: Ol = { type: 'ol', children: items };
  if (attrs) node.attributes = attrs;
  return node;
}

export function ul(items: Li[], attrs?: Ul['attributes']): Ul {
  const node: Ul = { type: 'ul', children: items };
  if (attrs) node.attributes = attrs;
  return node;
}

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

export function chapter(
  children: Chapter['children'],
  attrs?: Chapter['attributes'],
): Chapter {
  const node: Chapter = { type: 'chapter', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function section(
  children: Section['children'],
  attrs?: Section['attributes'],
): Section {
  const node: Section = { type: 'section', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function subsection(
  children: Subsection['children'],
  attrs?: Subsection['attributes'],
): Subsection {
  const node: Subsection = { type: 'subsection', children };
  if (attrs) node.attributes = attrs;
  return node;
}

// ---------------------------------------------------------------------------
// Block environments
// ---------------------------------------------------------------------------

export function statement(children: PtxBlockContent[]): Statement {
  return { type: 'statement', children };
}

export function proof(
  children: (Title | PtxBlockContent)[],
  attrs?: Proof['attributes'],
): Proof {
  const node: Proof = { type: 'proof', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function solution(
  children: (Title | PtxBlockContent)[],
  attrs?: Solution['attributes'],
): Solution {
  const node: Solution = { type: 'solution', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function hint(
  children: (Title | PtxBlockContent)[],
  attrs?: Hint['attributes'],
): Hint {
  const node: Hint = { type: 'hint', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function answer(
  children: (Title | PtxBlockContent)[],
  attrs?: Answer['attributes'],
): Answer {
  const node: Answer = { type: 'answer', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function theorem(
  children: Theorem['children'],
  attrs?: Theorem['attributes'],
): Theorem {
  const node: Theorem = { type: 'theorem', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function lemma(
  children: Lemma['children'],
  attrs?: Lemma['attributes'],
): Lemma {
  const node: Lemma = { type: 'lemma', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function corollary(
  children: Corollary['children'],
  attrs?: Corollary['attributes'],
): Corollary {
  const node: Corollary = { type: 'corollary', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function proposition(
  children: Proposition['children'],
  attrs?: Proposition['attributes'],
): Proposition {
  const node: Proposition = { type: 'proposition', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function definition(
  children: Definition['children'],
  attrs?: Definition['attributes'],
): Definition {
  const node: Definition = { type: 'definition', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function remark(
  children: Remark['children'],
  attrs?: Remark['attributes'],
): Remark {
  const node: Remark = { type: 'remark', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function note(
  children: Note['children'],
  attrs?: Note['attributes'],
): Note {
  const node: Note = { type: 'note', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function warning(
  children: Warning['children'],
  attrs?: Warning['attributes'],
): Warning {
  const node: Warning = { type: 'warning', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function example(
  children: Example['children'],
  attrs?: Example['attributes'],
): Example {
  const node: Example = { type: 'example', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function exercise(
  children: Exercise['children'],
  attrs?: Exercise['attributes'],
): Exercise {
  const node: Exercise = { type: 'exercise', children };
  if (attrs) node.attributes = attrs;
  return node;
}

export function assemblage(
  children: Assemblage['children'],
  attrs?: Assemblage['attributes'],
): Assemblage {
  const node: Assemblage = { type: 'assemblage', children };
  if (attrs) node.attributes = attrs;
  return node;
}
