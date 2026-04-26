import { describe, it, expect } from 'vitest';
import {
  isPtxNode,
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

describe('isPtxNode', () => {
  it('accepts objects with a string type', () => {
    expect(isPtxNode({ type: 'p', children: [] })).toBe(true);
    expect(isPtxNode({ type: 'theorem', children: [] })).toBe(true);
  });

  it('rejects primitives and null', () => {
    expect(isPtxNode(null)).toBe(false);
    expect(isPtxNode(undefined)).toBe(false);
    expect(isPtxNode('string')).toBe(false);
    expect(isPtxNode(42)).toBe(false);
  });

  it('rejects objects without type', () => {
    expect(isPtxNode({})).toBe(false);
    expect(isPtxNode({ name: 'foo' })).toBe(false);
  });
});

describe('isParent', () => {
  it('accepts nodes with children array', () => {
    expect(isParent({ type: 'p', children: [] })).toBe(true);
    expect(isParent({ type: 'section', children: [{ type: 'p', children: [] }] })).toBe(true);
  });

  it('rejects nodes without children', () => {
    expect(isParent({ type: 'm', value: 'x^2' })).toBe(false);
    expect(isParent({ type: 'c', value: 'code' })).toBe(false);
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
  it('isP rejects a bare {type:"p"} with no children', () => {
    expect(isP({ type: 'p' })).toBe(false);
  });

  it('isP accepts a valid p node', () => {
    expect(isP({ type: 'p', children: [] })).toBe(true);
  });

  it('isM rejects {type:"m"} with no value', () => {
    expect(isM({ type: 'm' })).toBe(false);
  });

  it('isM accepts {type:"m", value:"x^2"}', () => {
    expect(isM({ type: 'm', value: 'x^2' })).toBe(true);
  });

  it('isXref rejects {type:"xref"} with no attributes.ref', () => {
    expect(isXref({ type: 'xref' })).toBe(false);
    expect(isXref({ type: 'xref', attributes: {} })).toBe(false);
    expect(isXref({ type: 'xref', attributes: { ref: undefined } })).toBe(false);
  });

  it('isXref accepts a valid xref node', () => {
    expect(isXref({ type: 'xref', attributes: { ref: 'thm-main' } })).toBe(true);
  });

  it('isSection rejects {type:"section"} with no children', () => {
    expect(isSection({ type: 'section' })).toBe(false);
  });

  it('isPtxText rejects {type:"text"} with no value', () => {
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

  it('p() creates a paragraph', () => {
    const node = p([text('content')]);
    expect(node.type).toBe('p');
    expect(node.children).toHaveLength(1);
    expect(node.children[0]).toEqual(text('content'));
  });

  it('p() accepts optional attributes', () => {
    const node = p([text('x')], { 'xml:id': 'p-intro' });
    expect(node.attributes?.['xml:id']).toBe('p-intro');
  });

  it('m() creates inline math', () => {
    const node = m('a^2 + b^2');
    expect(node.type).toBe('m');
    expect(node.value).toBe('a^2 + b^2');
  });

  it('me() creates display math', () => {
    const node = me('a^2 + b^2 = c^2');
    expect(node.type).toBe('me');
    expect(node.value).toBe('a^2 + b^2 = c^2');
  });

  it('xref() creates a cross-reference', () => {
    const node = xref('thm-pythagoras');
    expect(node.type).toBe('xref');
    expect(node.attributes.ref).toBe('thm-pythagoras');
  });

  it('url() creates an external link', () => {
    const node = url('https://pretextbook.org', 'pretextbook.org');
    expect(node.type).toBe('url');
    expect(node.attributes.href).toBe('https://pretextbook.org');
    expect(node.attributes.visual).toBe('pretextbook.org');
  });

  it('theorem() creates a theorem with children and optional attrs', () => {
    const stmnt = statement([p([text('For all n...')])]);
    const prf = proof([p([text('Proof by induction.')])]);
    const node = theorem([stmnt, prf], { 'xml:id': 'thm-main' });
    expect(node.type).toBe('theorem');
    expect(node.attributes?.['xml:id']).toBe('thm-main');
    expect(node.children).toHaveLength(2);
  });

  it('section() creates a section with optional id', () => {
    const node = section([p([text('intro')])], { 'xml:id': 'sec-intro' });
    expect(node.type).toBe('section');
    expect(node.attributes?.['xml:id']).toBe('sec-intro');
  });

  it('ol() creates an ordered list', () => {
    const node = ol([li([p([text('item 1')])]), li([p([text('item 2')])])]);
    expect(node.type).toBe('ol');
    expect(node.children).toHaveLength(2);
  });

  it('ul() creates an unordered list', () => {
    const node = ul([li([p([text('item')])])]);
    expect(node.type).toBe('ul');
    expect(node.children).toHaveLength(1);
  });

  it('em() creates emphasis', () => {
    const node = em([text('important')]);
    expect(node.type).toBe('em');
    expect(node.children[0]).toEqual(text('important'));
  });

  it('title() creates a title', () => {
    const node = title([text('Pythagorean Theorem')]);
    expect(node.type).toBe('title');
    expect(node.children[0]).toEqual(text('Pythagorean Theorem'));
  });

  it('example() with solution', () => {
    const node = example([
      p([text('Show that 2 is even.')]),
      solution([p([text('2 = 2 * 1, which is even.')])]),
    ], { 'xml:id': 'ex-two-even' });
    expect(node.type).toBe('example');
    expect(node.children).toHaveLength(2);
    expect(node.children[1].type).toBe('solution');
  });

  it('definition() produces correct type', () => {
    const node = definition([
      title([text('Prime Number')]),
      statement([p([text('An integer p > 1 is prime if...')])]),
    ], { 'xml:id': 'def-prime' });
    expect(node.type).toBe('definition');
  });
});
