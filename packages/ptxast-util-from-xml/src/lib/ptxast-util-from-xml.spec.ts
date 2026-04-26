import { describe, it, expect } from 'vitest';
import { ptxastFromXml, ptxastNodeFromXml } from './ptxast-util-from-xml.js';
import type { PtxRoot, P, M, Me, Theorem, Section, Title, Statement, Em, C, Ol, Li, PtxText } from '@pretextbook/ptxast';

describe('ptxastFromXml', () => {
  it('parses an empty fragment', () => {
    const root = ptxastFromXml('<p></p>');
    expect(root.type).toBe('root');
    expect(root.children).toHaveLength(1);
  });

  it('parses a paragraph with text', () => {
    const root = ptxastFromXml('<p>Hello, world.</p>');
    const p = root.children[0] as P;
    expect(p.type).toBe('p');
    expect((p.children[0] as PtxText).value).toBe('Hello, world.');
  });

  it('parses inline emphasis', () => {
    const root = ptxastFromXml('<p>Some <em>emphasized</em> text.</p>');
    const p = root.children[0] as P;
    expect(p.children[1].type).toBe('em');
    const em = p.children[1] as Em;
    expect((em.children[0] as PtxText).value).toBe('emphasized');
  });

  it('parses inline code (value node)', () => {
    const root = ptxastFromXml('<p><c>x := 0</c></p>');
    const p = root.children[0] as P;
    const c = p.children[0] as C;
    expect(c.type).toBe('c');
    expect(c.value).toBe('x := 0');
  });

  it('parses inline math (value node)', () => {
    const root = ptxastFromXml('<p><m>x^2 + 1</m></p>');
    const p = root.children[0] as P;
    const m = p.children[0] as M;
    expect(m.type).toBe('m');
    expect(m.value).toBe('x^2 + 1');
  });

  it('parses display math (value node)', () => {
    const root = ptxastFromXml('<me>a^2 + b^2 = c^2</me>');
    const me = root.children[0] as Me;
    expect(me.type).toBe('me');
    expect(me.value).toBe('a^2 + b^2 = c^2');
  });

  it('parses a section with xml:id and title', () => {
    const root = ptxastFromXml(
      '<section xml:id="sec-intro"><title>Introduction</title><p>Body.</p></section>'
    );
    const section = root.children[0] as Section;
    expect(section.type).toBe('section');
    expect(section.attributes?.['xml:id']).toBe('sec-intro');
    const title = section.children[0] as Title;
    expect(title.type).toBe('title');
    expect((title.children[0] as PtxText).value).toBe('Introduction');
  });

  it('parses a theorem with statement', () => {
    const xml = `<theorem xml:id="thm-pythagoras">
      <title>Pythagorean Theorem</title>
      <statement><p>For a right triangle.</p></statement>
    </theorem>`;
    const root = ptxastFromXml(xml);
    const thm = root.children[0] as Theorem;
    expect(thm.type).toBe('theorem');
    expect(thm.attributes?.['xml:id']).toBe('thm-pythagoras');
    const stmt = thm.children.find(n => n.type === 'statement') as Statement;
    expect(stmt).toBeDefined();
    expect(stmt.children[0].type).toBe('p');
  });

  it('parses an ordered list', () => {
    const root = ptxastFromXml('<ol><li><p>First</p></li><li><p>Second</p></li></ol>');
    const ol = root.children[0] as Ol;
    expect(ol.type).toBe('ol');
    expect(ol.children).toHaveLength(2);
    const li = ol.children[0] as Li;
    expect(li.type).toBe('li');
  });

  it('drops whitespace-only text nodes between elements', () => {
    const root = ptxastFromXml('<section>\n  <title>T</title>\n  <p>Body.</p>\n</section>');
    const section = root.children[0] as Section;
    // Whitespace text nodes between title and p should be dropped
    const types = section.children.map(c => c.type);
    expect(types).not.toContain('text');
    expect(types).toContain('title');
    expect(types).toContain('p');
  });

  it('preserves non-whitespace text nodes', () => {
    const root = ptxastFromXml('<p>Hello <em>world</em>!</p>');
    const p = root.children[0] as P;
    const last = p.children[p.children.length - 1] as PtxText;
    expect(last.type).toBe('text');
    expect(last.value).toBe('!');
  });

  it('preserves single space between inline elements', () => {
    const root = ptxastFromXml('<p><em>a</em> <em>b</em></p>');
    const p = root.children[0] as P;
    // Space node between the two em elements must be preserved
    const space = p.children.find(n => n.type === 'text' && (n as PtxText).value === ' ');
    expect(space).toBeDefined();
  });

  it('handles CDATA content in value nodes', () => {
    const root = ptxastFromXml('<c><![CDATA[a < b & c > d]]></c>');
    const c = root.children[0] as C;
    expect(c.type).toBe('c');
    expect(c.value).toBe('a < b & c > d');
  });

  it('handles CDATA content in paragraph text', () => {
    const root = ptxastFromXml('<p><![CDATA[a < b]]></p>');
    const p = root.children[0] as P;
    expect((p.children[0] as PtxText).value).toBe('a < b');
  });

  it('drops XML comments', () => {
    const root = ptxastFromXml('<p><!-- comment -->text</p>');
    const p = root.children[0] as P;
    expect(p.children.every(c => c.type !== 'comment')).toBe(true);
  });

  it('handles elements with no attributes (no attributes field)', () => {
    const root = ptxastFromXml('<p>Text</p>');
    const p = root.children[0] as P;
    // Attribute object should not be present when empty
    expect(p.attributes).toBeUndefined();
  });
});

describe('ptxastNodeFromXml', () => {
  it('parses a single element', () => {
    const node = ptxastNodeFromXml('<p>Single node.</p>') as P;
    expect(node.type).toBe('p');
    expect((node.children[0] as PtxText).value).toBe('Single node.');
  });

  it('parses a value node (me)', () => {
    const node = ptxastNodeFromXml('<me>x = 1</me>') as Me;
    expect(node.type).toBe('me');
    expect(node.value).toBe('x = 1');
  });

  it('throws when given multiple root elements or invalid XML', () => {
    // xast-util-from-xml throws if XML is not well-formed (multiple roots)
    expect(() => ptxastNodeFromXml('<p>one</p><p>two</p>')).toThrow();
  });
});

describe('round-trip: ptxastFromXml → ptxastRootToXml', () => {
  it('round-trips a paragraph', async () => {
    const { ptxastRootToXml } = await import('@pretextbook/ptxast-util-to-xml');
    const xml = '<p>Hello, <em>world</em>!</p>';
    const ptx = ptxastFromXml(xml);
    const out = ptxastRootToXml(ptx);
    expect(out).toBe(xml);
  });

  it('round-trips a section with xml:id', async () => {
    const { ptxastRootToXml } = await import('@pretextbook/ptxast-util-to-xml');
    const xml = '<section xml:id="sec-intro"><title>Intro</title><p>Body.</p></section>';
    const ptx = ptxastFromXml(xml);
    const out = ptxastRootToXml(ptx);
    expect(out).toBe(xml);
  });
});
