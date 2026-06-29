import { describe, it, expect } from 'vitest';
import {
  isElement,
  isParent,
  isPtxText,
  isTheorem,
  isSection,
  isP,
  isM,
  isXref,
  isProof,
} from './guards.js';
import {
  text,
  p,
  m,
  me,
  xref,
  url,
  theorem,
  proof,
  section,
  definition,
  example,
  solution,
  ol,
  ul,
  li,
  statement,
  title,
  em,
} from './builders.js';
import { getPtxTextContent } from '../types/curated.js';

describe('isElement', () => {
  it('accepts valid xast element nodes', () => {
    expect(isElement(p([]))).toBe(true);
    expect(isElement(theorem([]))).toBe(true);
    expect(isElement(section([]))).toBe(true);
  });

  it('rejects primitives and null', () => {
    expect(isElement(null)).toBe(false);
    expect(isElement(undefined)).toBe(false);
    expect(isElement('string')).toBe(false);
    expect(isElement(42)).toBe(false);
  });

  it('rejects nodes without type:element or missing name', () => {
    expect(isElement({})).toBe(false);
    expect(isElement({ name: 'foo' })).toBe(false);
    expect(isElement({ type: 'text', value: 'hi' })).toBe(false);
    expect(isElement({ type: 'root', children: [] })).toBe(false);
  });
});

describe('isParent', () => {
  it('accepts element nodes (all xast elements have children)', () => {
    expect(isParent(p([]))).toBe(true);
    expect(isParent(section([p([])]))).toBe(true);
    expect(isParent(m('x^2'))).toBe(true);
  });

  it('accepts Root nodes', () => {
    expect(isParent({ type: 'root', children: [] })).toBe(true);
  });

  it('rejects text nodes', () => {
    expect(isParent(text('hello'))).toBe(false);
    expect(isParent({ type: 'text', value: 'hi' })).toBe(false);
  });
});

describe('specific type guards', () => {
  it('isPtxText', () => {
    expect(isPtxText(text('hello'))).toBe(true);
    expect(isPtxText(p([]))).toBe(false);
  });

  it('isP', () => {
    const node = p([text('content')]);
    expect(isP(node)).toBe(true);
    expect(isP(text('x'))).toBe(false);
  });

  it('isSection', () => {
    const node = section([], { 'xml:id': 'sec-intro' });
    expect(isSection(node)).toBe(true);
    expect(isSection(p([]))).toBe(false);
  });

  it('isTheorem', () => {
    const node = theorem([]);
    expect(isTheorem(node)).toBe(true);
    expect(isTheorem(proof([]))).toBe(false);
  });

  it('isProof', () => {
    const node = proof([p([text('QED')])]);
    expect(isProof(node)).toBe(true);
    expect(isProof(theorem([]))).toBe(false);
  });

  it('isM', () => {
    expect(isM(m('a^2'))).toBe(true);
    expect(isM(me('a^2 + b^2 = c^2'))).toBe(false);
  });

  it('isXref', () => {
    const ref = xref('thm-pythagoras');
    expect(isXref(ref)).toBe(true);
    expect(isXref(url('https://example.com'))).toBe(false);
  });
});

describe('guard soundness', () => {
  it('isP rejects non-element nodes', () => {
    expect(isP({ type: 'p' })).toBe(false);
    expect(isP(text('hi'))).toBe(false);
  });

  it('isP accepts a valid xast p node', () => {
    expect(isP(p([]))).toBe(true);
    expect(isP({ type: 'element', name: 'p', attributes: {}, children: [] })).toBe(true);
  });

  it('isM rejects non-element and wrong-name nodes', () => {
    expect(isM({ type: 'm' })).toBe(false);
    expect(isM({ type: 'element', name: 'me', attributes: {}, children: [] })).toBe(false);
  });

  it('isM accepts a valid xast m node', () => {
    expect(isM(m('x^2'))).toBe(true);
    expect(isM({ type: 'element', name: 'm', attributes: {}, children: [] })).toBe(true);
  });

  it('isXref rejects nodes without attributes.ref', () => {
    expect(isXref({ type: 'xref' })).toBe(false);
    expect(isXref({ type: 'element', name: 'xref', attributes: {}, children: [] })).toBe(false);
    expect(isXref({ type: 'element', name: 'xref', attributes: { ref: undefined }, children: [] })).toBe(false);
  });

  it('isXref accepts a valid xref node', () => {
    expect(isXref(xref('thm-main'))).toBe(true);
    expect(isXref({ type: 'element', name: 'xref', attributes: { ref: 'thm-main' }, children: [] })).toBe(true);
  });

  it('isSection rejects nodes without name:section', () => {
    expect(isSection({ type: 'section' })).toBe(false);
    expect(isSection({ type: 'element', name: 'p', attributes: {}, children: [] })).toBe(false);
  });

  it('isPtxText rejects nodes without value', () => {
    expect(isPtxText({ type: 'text' })).toBe(false);
  });
});

describe('xref() builder safety', () => {
  it('xref() sets ref correctly', () => {
    expect(xref('thm-main').attributes.ref).toBe('thm-main');
  });

  it('xref() with extra attrs does not lose ref', () => {
    const node = xref('thm-main', { text: 'Theorem 1' });
    expect(node.attributes.ref).toBe('thm-main');
    expect(node.attributes.text).toBe('Theorem 1');
  });
});

describe('builders', () => {
  it('text() creates a text node', () => {
    const node = text('hello world');
    expect(node.type).toBe('text');
    expect(node.value).toBe('hello world');
  });

  it('p() creates a paragraph xast element', () => {
    const node = p([text('content')]);
    expect(node.type).toBe('element');
    expect(node.name).toBe('p');
    expect(node.children).toHaveLength(1);
    expect(node.children[0]).toEqual(text('content'));
  });

  it('p() accepts optional attributes', () => {
    const node = p([text('x')], { 'xml:id': 'p-intro' });
    expect(node.attributes?.['xml:id']).toBe('p-intro');
  });

  it('m() creates inline math with Text child', () => {
    const node = m('a^2 + b^2');
    expect(node.type).toBe('element');
    expect(node.name).toBe('m');
    expect(getPtxTextContent(node)).toBe('a^2 + b^2');
  });

  it('me() creates display math with Text child', () => {
    const node = me('a^2 + b^2 = c^2');
    expect(node.type).toBe('element');
    expect(node.name).toBe('me');
    expect(getPtxTextContent(node)).toBe('a^2 + b^2 = c^2');
  });

  it('xref() creates a cross-reference', () => {
    const node = xref('thm-pythagoras');
    expect(node.type).toBe('element');
    expect(node.name).toBe('xref');
    expect(node.attributes.ref).toBe('thm-pythagoras');
  });

  it('url() creates an external link', () => {
    const node = url('https://pretextbook.org', 'pretextbook.org');
    expect(node.type).toBe('element');
    expect(node.name).toBe('url');
    expect(node.attributes.href).toBe('https://pretextbook.org');
    expect(node.attributes.visual).toBe('pretextbook.org');
  });

  it('theorem() creates a theorem with children and optional attrs', () => {
    const stmnt = statement([p([text('For all n...')])]);
    const prf = proof([p([text('Proof by induction.')])]);
    const node = theorem([stmnt, prf], { 'xml:id': 'thm-main' });
    expect(node.type).toBe('element');
    expect(node.name).toBe('theorem');
    expect(node.attributes?.['xml:id']).toBe('thm-main');
    expect(node.children).toHaveLength(2);
  });

  it('section() creates a section with optional id', () => {
    const node = section([p([text('intro')])], { 'xml:id': 'sec-intro' });
    expect(node.type).toBe('element');
    expect(node.name).toBe('section');
    expect(node.attributes?.['xml:id']).toBe('sec-intro');
  });

  it('ol() creates an ordered list', () => {
    const node = ol([li([p([text('item 1')])]), li([p([text('item 2')])])]);
    expect(node.type).toBe('element');
    expect(node.name).toBe('ol');
    expect(node.children).toHaveLength(2);
  });

  it('ul() creates an unordered list', () => {
    const node = ul([li([p([text('item')])])]);
    expect(node.type).toBe('element');
    expect(node.name).toBe('ul');
    expect(node.children).toHaveLength(1);
  });

  it('em() creates emphasis', () => {
    const node = em([text('important')]);
    expect(node.type).toBe('element');
    expect(node.name).toBe('em');
    expect(node.children[0]).toEqual(text('important'));
  });

  it('title() creates a title', () => {
    const node = title([text('Pythagorean Theorem')]);
    expect(node.type).toBe('element');
    expect(node.name).toBe('title');
    expect(node.children[0]).toEqual(text('Pythagorean Theorem'));
  });

  it('example() with solution', () => {
    const node = example([
      p([text('Show that 2 is even.')]),
      solution([p([text('2 = 2 * 1, which is even.')])]),
    ], { 'xml:id': 'ex-two-even' });
    expect(node.type).toBe('element');
    expect(node.name).toBe('example');
    expect(node.children).toHaveLength(2);
    const child = node.children[1] as { type: string; name: string };
    expect(child.type).toBe('element');
    expect(child.name).toBe('solution');
  });

  it('definition() produces correct name', () => {
    const node = definition([
      title([text('Prime Number')]),
      statement([p([text('An integer p > 1 is prime if...')])]),
    ], { 'xml:id': 'def-prime' });
    expect(node.type).toBe('element');
    expect(node.name).toBe('definition');
  });
});
