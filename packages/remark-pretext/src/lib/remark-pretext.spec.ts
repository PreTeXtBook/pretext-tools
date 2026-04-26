import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';
import { describe, it, expect } from 'vitest';
import { remarkPretext, mdastToPtxast } from '../index.js';
import type {
  PtxRoot,
  Section,
  Chapter,
  Subsection,
  P,
  PtxText,
  Em,
  Alert,
  C,
  M,
  Me,
  Ol,
  Ul,
  Li,
  Title,
  Statement,
  Proof,
  Theorem,
} from '@pretextbook/ptxast';
import type { Root as MdastRoot } from 'mdast';

/** Helper: parse markdown and transform to ptxast. */
function parse(md: string): PtxRoot {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkMath)
    .use(remarkPretext);
  const mdast = processor.parse(md);
  return processor.runSync(mdast) as unknown as PtxRoot;
}

describe('paragraph conversion', () => {
  it('converts a paragraph to a p node', () => {
    const tree = parse('Hello world.');
    expect(tree.type).toBe('root');
    expect(tree.children).toHaveLength(1);
    const p = tree.children[0] as P;
    expect(p.type).toBe('p');
  });

  it('p node contains text children', () => {
    const tree = parse('Hello world.');
    const p = tree.children[0] as P;
    expect(p.children[0]).toEqual({ type: 'text', value: 'Hello world.' });
  });

  it('converts multiple paragraphs', () => {
    const tree = parse('First.\n\nSecond.');
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].type).toBe('p');
    expect(tree.children[1].type).toBe('p');
  });
});

describe('inline element conversion', () => {
  it('emphasis → em', () => {
    const tree = parse('*italic*');
    const p = tree.children[0] as P;
    const em = p.children[0] as Em;
    expect(em.type).toBe('em');
    expect((em.children[0] as PtxText).value).toBe('italic');
  });

  it('strong → alert', () => {
    const tree = parse('**bold**');
    const p = tree.children[0] as P;
    const alert = p.children[0] as Alert;
    expect(alert.type).toBe('alert');
    expect((alert.children[0] as PtxText).value).toBe('bold');
  });

  it('inlineCode → c', () => {
    const tree = parse('Use `x := 0`.');
    const p = tree.children[0] as P;
    // mixed children: text + c + text
    const c = p.children.find(n => n.type === 'c') as C;
    expect(c.type).toBe('c');
    expect(c.value).toBe('x := 0');
  });

  it('inline math → m', () => {
    const tree = parse('Let $x^2 + 1$.');
    const p = tree.children[0] as P;
    const m = p.children.find(n => n.type === 'm') as M;
    expect(m.type).toBe('m');
    expect(m.value).toBe('x^2 + 1');
  });
});

describe('display math', () => {
  it('display math → me', () => {
    const tree = parse('$$\na^2 + b^2 = c^2\n$$');
    expect(tree.children[0].type).toBe('me');
    const me = tree.children[0] as Me;
    expect(me.value).toBe('a^2 + b^2 = c^2');
  });
});

describe('list conversion', () => {
  it('unordered list → ul with li children', () => {
    const tree = parse('- alpha\n- beta\n- gamma');
    const ul = tree.children[0] as Ul;
    expect(ul.type).toBe('ul');
    expect(ul.children).toHaveLength(3);
    expect(ul.children[0].type).toBe('li');
  });

  it('ordered list → ol', () => {
    const tree = parse('1. first\n2. second');
    const ol = tree.children[0] as Ol;
    expect(ol.type).toBe('ol');
    expect(ol.children).toHaveLength(2);
  });

  it('li children contain p nodes', () => {
    const tree = parse('- item text');
    const ul = tree.children[0] as Ul;
    const li = ul.children[0] as Li;
    expect(li.type).toBe('li');
    expect(li.children[0].type).toBe('p');
  });
});

describe('heading → section nesting', () => {
  it('## heading → section with title', () => {
    const tree = parse('## My Section\n\nSome text.');
    const section = tree.children[0] as Section;
    expect(section.type).toBe('section');
    const title = section.children[0] as Title;
    expect(title.type).toBe('title');
    expect((title.children[0] as PtxText).value).toBe('My Section');
  });

  it('section body contains converted blocks', () => {
    const tree = parse('## My Section\n\nA paragraph.');
    const section = tree.children[0] as Section;
    // children[0] = title, children[1] = p
    expect(section.children[1].type).toBe('p');
  });

  it('# heading → chapter', () => {
    const tree = parse('# Chapter One\n\nText.');
    expect(tree.children[0].type).toBe('chapter');
  });

  it('### heading → subsection', () => {
    const tree = parse('### Deep\n\nText.');
    expect(tree.children[0].type).toBe('subsection');
  });

  it('section contains subsection from deeper heading', () => {
    const tree = parse('## Section\n\n### Subsection\n\nText.');
    const section = tree.children[0] as Section;
    // children: [title, subsection]
    expect(section.children.some(c => c.type === 'subsection')).toBe(true);
  });

  it('content before any heading is a direct child of root', () => {
    const tree = parse('Intro text.\n\n## Section\n\nBody.');
    expect(tree.children[0].type).toBe('p');
    expect(tree.children[1].type).toBe('section');
  });
});

describe('container directives', () => {
  it(':::theorem directive → theorem node', () => {
    const tree = parse(':::theorem\nStatement text.\n:::');
    const thm = tree.children[0] as Theorem;
    expect(thm.type).toBe('theorem');
  });

  it('theorem body is wrapped in a statement node', () => {
    const tree = parse(':::theorem\nStatement text.\n:::');
    const thm = tree.children[0] as Theorem;
    // no title → first child is statement
    const stmt = thm.children[0] as Statement;
    expect(stmt.type).toBe('statement');
    expect(stmt.children[0].type).toBe('p');
  });

  it('theorem title from directive label', () => {
    const tree = parse(':::theorem[Pythagoras]\nFor right triangles.\n:::');
    const thm = tree.children[0] as Theorem;
    const title = thm.children[0] as Title;
    expect(title.type).toBe('title');
    expect((title.children[0] as PtxText).value).toBe('Pythagoras');
  });

  it(':::theorem with xml:id attribute from {#id}', () => {
    const tree = parse(':::theorem{#thm-pyth}\nText.\n:::');
    const thm = tree.children[0] as Theorem;
    expect(thm.attributes?.['xml:id']).toBe('thm-pyth');
  });

  it('nested :::proof inside :::theorem becomes a proof child', () => {
    const tree = parse(
      ':::theorem\nStatement.\n\n:::proof\nProof body.\n:::\n:::'
    );
    const thm = tree.children[0] as Theorem;
    const proof = thm.children.find(c => c.type === 'proof') as Proof;
    expect(proof).toBeDefined();
    expect(proof.type).toBe('proof');
    expect(proof.children[0].type).toBe('p');
  });

  it(':::definition directive → definition node', () => {
    const tree = parse(':::definition\nA function.\n:::');
    expect(tree.children[0].type).toBe('definition');
  });

  it(':::remark directive → remark node', () => {
    const tree = parse(':::remark\nA remark.\n:::');
    expect(tree.children[0].type).toBe('remark');
  });

  it(':::example directive → example node', () => {
    const tree = parse(':::example\nAn example.\n:::');
    expect(tree.children[0].type).toBe('example');
  });

  it(':::proof directive → proof node', () => {
    const tree = parse(':::proof\nTrivial.\n:::');
    expect(tree.children[0].type).toBe('proof');
  });

  it('unknown directive is dropped (returns null)', () => {
    const tree = parse(':::unknownblock\nContent.\n:::');
    // unknown directive → no ptxast node → dropped from output
    expect(tree.children.every(c => c.type !== 'unknownblock')).toBe(true);
  });
});

describe('mdastToPtxast standalone function', () => {
  it('accepts an mdast Root and returns a PtxRoot', () => {
    const processor = unified().use(remarkParse).use(remarkDirective).use(remarkMath);
    const mdast = processor.parse('Hello.') as MdastRoot;
    const ptx = mdastToPtxast(mdast);
    expect(ptx.type).toBe('root');
    expect(ptx.children[0].type).toBe('p');
  });
});
