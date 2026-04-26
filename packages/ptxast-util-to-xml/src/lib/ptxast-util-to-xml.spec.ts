import { describe, it, expect } from 'vitest';
import { ptxastRootToXml, ptxastNodeToXml } from './ptxast-util-to-xml.js';
import type { PtxRoot, P, M, Me, Theorem, Section, Title, Statement, PtxText, Em, C, Ol, Li } from '@pretextbook/ptxast';

describe('ptxastRootToXml', () => {
  it('serializes an empty root', () => {
    const root: PtxRoot = { type: 'root', children: [] };
    expect(ptxastRootToXml(root)).toBe('');
  });

  it('serializes a simple paragraph', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{
        type: 'p',
        children: [{ type: 'text', value: 'Hello, world.' } as PtxText],
      } as P],
    };
    expect(ptxastRootToXml(root)).toBe('<p>Hello, world.</p>');
  });

  it('serializes inline emphasis', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{
        type: 'p',
        children: [
          { type: 'text', value: 'Some ' } as PtxText,
          { type: 'em', children: [{ type: 'text', value: 'emphasized' } as PtxText] } as Em,
          { type: 'text', value: ' text.' } as PtxText,
        ],
      } as P],
    };
    expect(ptxastRootToXml(root)).toBe('<p>Some <em>emphasized</em> text.</p>');
  });

  it('serializes inline code', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{
        type: 'p',
        children: [{ type: 'c', value: 'x := 0' } as C],
      } as P],
    };
    expect(ptxastRootToXml(root)).toBe('<p><c>x := 0</c></p>');
  });

  it('serializes inline math', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{
        type: 'p',
        children: [{ type: 'm', value: 'x^2 + 1' } as M],
      } as P],
    };
    expect(ptxastRootToXml(root)).toBe('<p><m>x^2 + 1</m></p>');
  });

  it('serializes display math (me)', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{ type: 'me', value: 'a^2 + b^2 = c^2' } as Me],
    };
    expect(ptxastRootToXml(root)).toBe('<me>a^2 + b^2 = c^2</me>');
  });

  it('serializes a section with title and paragraph', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{
        type: 'section',
        attributes: { 'xml:id': 'sec-intro' },
        children: [
          { type: 'title', children: [{ type: 'text', value: 'Introduction' } as PtxText] } as Title,
          { type: 'p', children: [{ type: 'text', value: 'A body paragraph.' } as PtxText] } as P,
        ],
      } as Section],
    };
    expect(ptxastRootToXml(root)).toBe(
      '<section xml:id="sec-intro"><title>Introduction</title><p>A body paragraph.</p></section>'
    );
  });

  it('serializes a theorem with statement', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{
        type: 'theorem',
        attributes: { 'xml:id': 'thm-pythagoras' },
        children: [
          { type: 'title', children: [{ type: 'text', value: 'Pythagorean Theorem' } as PtxText] } as Title,
          {
            type: 'statement',
            children: [{ type: 'p', children: [{ type: 'text', value: 'For a right triangle...' } as PtxText] } as P],
          } as Statement,
        ],
      } as Theorem],
    };
    const xml = ptxastRootToXml(root);
    expect(xml).toContain('<theorem xml:id="thm-pythagoras">');
    expect(xml).toContain('<title>Pythagorean Theorem</title>');
    expect(xml).toContain('<statement><p>For a right triangle...</p></statement>');
    expect(xml).toContain('</theorem>');
  });

  it('serializes an ordered list', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{
        type: 'ol',
        children: [
          { type: 'li', children: [{ type: 'p', children: [{ type: 'text', value: 'First' } as PtxText] } as P] } as Li,
          { type: 'li', children: [{ type: 'p', children: [{ type: 'text', value: 'Second' } as PtxText] } as P] } as Li,
        ],
      } as Ol],
    };
    expect(ptxastRootToXml(root)).toBe('<ol><li><p>First</p></li><li><p>Second</p></li></ol>');
  });

  it('escapes special XML characters in text', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{
        type: 'p',
        children: [{ type: 'text', value: 'a < b & b > c' } as PtxText],
      } as P],
    };
    const xml = ptxastRootToXml(root);
    // xast-util-to-xml uses numeric entities for XML special chars
    expect(xml).not.toContain('<p>a < b');
    expect(xml).toContain('&#x3C;');  // <
    expect(xml).toContain('&#x26;');  // &
  });

  it('omits undefined attributes', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{
        type: 'p',
        attributes: { 'xml:id': undefined },
        children: [{ type: 'text', value: 'Text' } as PtxText],
      } as P],
    };
    const xml = ptxastRootToXml(root);
    expect(xml).toBe('<p>Text</p>');
  });
});

describe('ptxastNodeToXml', () => {
  it('serializes a single node', () => {
    const p: P = {
      type: 'p',
      children: [{ type: 'text', value: 'Single node.' } as PtxText],
    };
    expect(ptxastNodeToXml(p)).toBe('<p>Single node.</p>');
  });

  it('serializes a value node (me)', () => {
    const me: Me = { type: 'me', value: 'x = 1' };
    expect(ptxastNodeToXml(me)).toBe('<me>x = 1</me>');
  });
});
