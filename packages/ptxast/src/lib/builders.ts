/**
 * Builder functions for xast-style PreTeXt nodes.
 *
 * Each function produces an xast Element with `type: 'element'` and the
 * correct `name`. Value elements (math, code) encode their content as a
 * single Text child.
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

import type { Element } from 'xast';
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
} from '../types/curated.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Create a plain xast Text node. */
export function text(value: string): PtxText {
  return { type: 'text', value };
}

function el<N extends string>(
  name: N,
  children: Element['children'],
  attributes?: Record<string, string>,
): Element & { name: N } {
  return {
    type: 'element',
    name,
    attributes: attributes ?? {},
    children,
  };
}

function valueEl<N extends string>(
  name: N,
  value: string,
  attributes?: Record<string, string>,
): Element & { name: N } {
  return el(name, [text(value)], attributes);
}

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

export function title(children: PtxInlineContent[]): Title {
  return el('title', children as Element['children']) as unknown as Title;
}

export function em(children: PtxInlineContent[]): Em {
  return el('em', children as Element['children']) as unknown as Em;
}

export function alert(children: PtxInlineContent[]): Alert {
  return el('alert', children as Element['children']) as unknown as Alert;
}

export function term(children: PtxInlineContent[]): Term {
  return el('term', children as Element['children']) as unknown as Term;
}

export function c(value: string): C {
  return valueEl('c', value) as unknown as C;
}

export function q(children: PtxInlineContent[]): Q {
  return el('q', children as Element['children']) as unknown as Q;
}

export function m(value: string): M {
  return valueEl('m', value) as unknown as M;
}

export function me(value: string): Me {
  return valueEl('me', value) as unknown as Me;
}

export function men(value: string, attrs?: Record<string, string>): Men {
  return valueEl('men', value, attrs) as unknown as Men;
}

export function xref(ref: string, extraAttrs?: Omit<Record<string, string>, 'ref'>): Xref {
  return el('xref', [], { ...extraAttrs, ref }) as unknown as Xref;
}

export function url(href: string, visual?: string): Url {
  return el('url', [], { href, ...(visual ? { visual } : {}) }) as unknown as Url;
}

export function fn(children: P[]): Fn {
  return el('fn', children as Element['children']) as unknown as Fn;
}

// ---------------------------------------------------------------------------
// Paragraph
// ---------------------------------------------------------------------------

export function p(
  children: PtxInlineContent[],
  attrs?: Record<string, string>,
): P {
  return el('p', children as Element['children'], attrs) as unknown as P;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function li(children: PtxBlockContent[]): Li {
  return el('li', children as Element['children']) as unknown as Li;
}

export function ol(items: Li[], attrs?: Record<string, string>): Ol {
  return el('ol', items as Element['children'], attrs) as unknown as Ol;
}

export function ul(items: Li[], attrs?: Record<string, string>): Ul {
  return el('ul', items as Element['children'], attrs) as unknown as Ul;
}

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

export function chapter(
  children: Chapter['children'],
  attrs?: Record<string, string>,
): Chapter {
  return el('chapter', children as Element['children'], attrs) as unknown as Chapter;
}

export function section(
  children: Section['children'],
  attrs?: Record<string, string>,
): Section {
  return el('section', children as Element['children'], attrs) as unknown as Section;
}

export function subsection(
  children: Subsection['children'],
  attrs?: Record<string, string>,
): Subsection {
  return el('subsection', children as Element['children'], attrs) as unknown as Subsection;
}

// ---------------------------------------------------------------------------
// Block environments
// ---------------------------------------------------------------------------

export function statement(children: PtxBlockContent[]): Statement {
  return el('statement', children as Element['children']) as unknown as Statement;
}

export function proof(
  children: (Title | PtxBlockContent)[],
  attrs?: Record<string, string>,
): Proof {
  return el('proof', children as Element['children'], attrs) as unknown as Proof;
}

export function solution(
  children: (Title | PtxBlockContent)[],
  attrs?: Record<string, string>,
): Solution {
  return el('solution', children as Element['children'], attrs) as unknown as Solution;
}

export function hint(
  children: (Title | PtxBlockContent)[],
  attrs?: Record<string, string>,
): Hint {
  return el('hint', children as Element['children'], attrs) as unknown as Hint;
}

export function answer(
  children: (Title | PtxBlockContent)[],
  attrs?: Record<string, string>,
): Answer {
  return el('answer', children as Element['children'], attrs) as unknown as Answer;
}

export function theorem(
  children: Theorem['children'],
  attrs?: Record<string, string>,
): Theorem {
  return el('theorem', children as Element['children'], attrs) as unknown as Theorem;
}

export function lemma(
  children: Lemma['children'],
  attrs?: Record<string, string>,
): Lemma {
  return el('lemma', children as Element['children'], attrs) as unknown as Lemma;
}

export function corollary(
  children: Corollary['children'],
  attrs?: Record<string, string>,
): Corollary {
  return el('corollary', children as Element['children'], attrs) as unknown as Corollary;
}

export function proposition(
  children: Proposition['children'],
  attrs?: Record<string, string>,
): Proposition {
  return el('proposition', children as Element['children'], attrs) as unknown as Proposition;
}

export function definition(
  children: Definition['children'],
  attrs?: Record<string, string>,
): Definition {
  return el('definition', children as Element['children'], attrs) as unknown as Definition;
}

export function remark(
  children: Remark['children'],
  attrs?: Record<string, string>,
): Remark {
  return el('remark', children as Element['children'], attrs) as unknown as Remark;
}

export function note(
  children: Note['children'],
  attrs?: Record<string, string>,
): Note {
  return el('note', children as Element['children'], attrs) as unknown as Note;
}

export function warning(
  children: Warning['children'],
  attrs?: Record<string, string>,
): Warning {
  return el('warning', children as Element['children'], attrs) as unknown as Warning;
}

export function example(
  children: Example['children'],
  attrs?: Record<string, string>,
): Example {
  return el('example', children as Element['children'], attrs) as unknown as Example;
}

export function exercise(
  children: Exercise['children'],
  attrs?: Record<string, string>,
): Exercise {
  return el('exercise', children as Element['children'], attrs) as unknown as Exercise;
}

export function assemblage(
  children: Assemblage['children'],
  attrs?: Record<string, string>,
): Assemblage {
  return el('assemblage', children as Element['children'], attrs) as unknown as Assemblage;
}
