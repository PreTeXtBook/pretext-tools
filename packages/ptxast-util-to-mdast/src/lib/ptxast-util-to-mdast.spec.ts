/**
 * Tests for ptxast-to-mdast and ptxastToMarkdown.
 *
 * Uses builders from @pretextbook/ptxast to construct xast nodes.
 */

import { describe, it, expect } from 'vitest';
import { ptxastToMdast } from './ptxast-to-mdast.js';
import { ptxastToMarkdown } from './ptxast-util-to-mdast.js';
import type { Root } from 'xast';
import { fromXml } from 'xast-util-from-xml';
import {
  text, em, alert, c, m, me, men,
  p, ol, ul, li, title,
  section, subsection, chapter,
  theorem, definition, remark, example, proof, statement,
} from '@pretextbook/ptxast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import { remarkPretext } from '@pretextbook/remark-pretext';
import type { Element } from 'xast';

//  Helpers ─

function md(root: Root): string {
  return ptxastToMarkdown(root).trim();
}

function parseMarkdownToXast(markdown: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkPretext);
  const mdast = processor.parse(markdown);
  return processor.runSync(mdast, { value: markdown }) as unknown as Root;
}

function nodeNameCounts(root: Root): Map<string, number> {
  const counts = new Map<string, number>();
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const current = stack.pop() as {
      type?: unknown;
      name?: unknown;
      children?: unknown;
    };
    if (!current || typeof current !== 'object') continue;
    if (current.type === 'element' && typeof current.name === 'string') {
      counts.set(current.name as string, (counts.get(current.name as string) ?? 0) + 1);
    }
    if (Array.isArray(current.children)) {
      for (let i = current.children.length - 1; i >= 0; i -= 1) {
        stack.push(current.children[i]);
      }
    }
  }

  return counts;
}

function root(...children: Root['children']): Root {
  return { type: 'root', children };
}

//  Plain text & paragraphs 

describe('paragraphs and inline', () => {
  it('converts a simple paragraph', () => {
    const xast = root(p([text('Hello world')]));
    const result = ptxastToMdast(xast);
    expect(result.type).toBe('root');
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({ type: 'paragraph' });
  });

  it('converts em (emphasis)', () => {
    const xast = root(p([text('See '), em([text('this')])]));
    expect(md(xast)).toBe('See *this*');
  });

  it('converts alert (strong)', () => {
    const xast = root(p([alert([text('Warning')])]));
    expect(md(xast)).toContain('**Warning**');
  });

  it('converts inline code (c)', () => {
    const xast = root(p([c('npm install')]));
    expect(md(xast)).toContain('`npm install`');
  });

  it('converts inline math (m)', () => {
    const xast = root(p([m('x^2')]));
    expect(md(xast)).toContain('$x^2$');
  });
});

//  Display math 

describe('display math', () => {
  it('converts me to display math block', () => {
    const xast = root(me('a^2 + b^2 = c^2'));
    const result = ptxastToMdast(xast);
    expect(result.children[0]).toMatchObject({ type: 'math', value: 'a^2 + b^2 = c^2' });
    expect(md(xast)).toContain('$$');
    expect(md(xast)).toContain('a^2 + b^2 = c^2');
  });

  it('converts men to display math block', () => {
    const xast = root(men('e = mc^2'));
    expect(ptxastToMdast(xast).children[0]).toMatchObject({ type: 'math' });
  });

  it('converts md value form to display math block', () => {
    // Single-line md: text child
    const xast = root({ type: 'element', name: 'md', attributes: {}, children: [{ type: 'text', value: 'a=b' }] } as Element);
    expect(ptxastToMdast(xast).children[0]).toMatchObject({ type: 'math', value: 'a=b' });
  });

  it('converts mdn mrow-children form to display math block', () => {
    const mdn = {
      type: 'element' as const,
      name: 'mdn',
      attributes: {},
      children: [
        { type: 'element' as const, name: 'mrow', attributes: {}, children: [{ type: 'text' as const, value: 'a=b' }] },
        { type: 'element' as const, name: 'mrow', attributes: {}, children: [{ type: 'text' as const, value: 'c=d' }] },
      ],
    };
    const xast = root(mdn as Element);
    const result = ptxastToMdast(xast);
    const expected = ['a=b', 'c=d'].join(' \\\\\n');
    expect(result.children[0]).toMatchObject({ type: 'math', value: expected });
  });
});

//  Lists ─

describe('lists', () => {
  it('converts ul to unordered list', () => {
    const xast = root(ul([li([p([text('Alpha')])]), li([p([text('Beta')])])]));
    const result = ptxastToMdast(xast);
    expect(result.children[0]).toMatchObject({ type: 'list', ordered: false });
    const output = md(xast);
    expect(output).toContain('* Alpha');
    expect(output).toContain('* Beta');
  });

  it('converts ol to ordered list', () => {
    const xast = root(ol([li([p([text('First')])]), li([p([text('Second')])])]));
    const result = ptxastToMdast(xast);
    expect(result.children[0]).toMatchObject({ type: 'list', ordered: true });
  });
});

//  Code / program 

describe('program', () => {
  it('converts program to fenced code with language', () => {
    const prog = { type: 'element' as const, name: 'program', attributes: { language: 'python' }, children: [{ type: 'text' as const, value: 'x = 1' }] } as Element;
    const output = md(root(prog));
    expect(output).toContain('```python');
    expect(output).toContain('x = 1');
  });

  it('converts program without language', () => {
    const prog = { type: 'element' as const, name: 'program', attributes: {}, children: [{ type: 'text' as const, value: 'hello' }] } as Element;
    expect(md(root(prog))).toContain('```');
  });
});

//  Divisions  headings ─

describe('divisions', () => {
  it('converts a section to a depth-2 heading', () => {
    const xast = root(section([title([text('Introduction')]), p([text('Body text.')])], { 'xml:id': 'sec-intro' }));
    const result = ptxastToMdast(xast);
    expect(result.children[0]).toMatchObject({ type: 'heading', depth: 2 });
    const h = result.children[0] as { type: string; depth: number; children: { value: string }[] };
    expect(h.children[0].value).toBe('Introduction');
    expect(result.children[1]).toMatchObject({ type: 'paragraph' });
    const output = md(xast);
    expect(output).toContain('## Introduction');
    expect(output).toContain('Body text.');
  });

  it('converts nested section/subsection to headings at correct depths', () => {
    const xast = root(section([title([text('Section')]), subsection([title([text('Sub')]), p([text('Content.')])])]));
    const output = md(xast);
    expect(output).toContain('## Section');
    expect(output).toContain('### Sub');
  });

  it('preserves xml:id as heading data', () => {
    const xast = root(section([title([text('Main')])], { 'xml:id': 'sec-main' }));
    const result = ptxastToMdast(xast);
    const heading = result.children[0] as { data?: { id?: string } };
    expect(heading.data?.id).toBe('sec-main');
  });

  it('converts chapter to depth-1 heading', () => {
    const xast = root(chapter([title([text('Chapter One')])]));
    const result = ptxastToMdast(xast);
    expect(result.children[0]).toMatchObject({ type: 'heading', depth: 1 });
    expect(md(xast)).toContain('# Chapter One');
  });
});

//  Theorem-like directives ─

describe('theorem-like blocks', () => {
  it('converts theorem with title and statement to container directive', () => {
    const xast = root(theorem([
      title([text('Pythagorean Theorem')]),
      statement([p([text('For a right triangle.')])]),
    ], { 'xml:id': 'thm-pyth' }));
    const result = ptxastToMdast(xast);
    expect(result.children[0]).toMatchObject({ type: 'containerDirective', name: 'theorem' });
    const output = md(xast);
    expect(output).toContain(':::theorem[Pythagorean Theorem]{#thm-pyth}');
    expect(output).toContain('For a right triangle.');
  });

  it('converts theorem with nested proof', () => {
    const xast = root(theorem([
      statement([p([text('The claim.')])]),
      proof([p([text('The proof.')])]),
    ]));
    const output = md(xast);
    expect(output).toContain('::::theorem');
    expect(output).toContain(':::proof');
    expect(output).toContain('The proof.');
  });

  it('converts definition (definition-like) with statement', () => {
    const xast = root(definition([
      title([text('Prime')]),
      statement([p([text('A prime number.')])]),
    ]));
    const output = md(xast);
    expect(output).toContain(':::definition[Prime]');
    expect(output).toContain('A prime number.');
  });
});

//  Remark-like / proof-like directives 

describe('remark-like and proof-like blocks', () => {
  it('converts proof without statement wrapper', () => {
    const xast = root(proof([p([text('QED.')])]));
    const result = ptxastToMdast(xast);
    expect(result.children[0]).toMatchObject({ type: 'containerDirective', name: 'proof' });
    expect(md(xast)).toContain(':::proof');
    expect(md(xast)).toContain('QED.');
  });

  it('converts remark block', () => {
    const xast = root(remark([p([text('Note this.')])]));
    expect(md(xast)).toContain(':::remark');
  });

  it('converts example block with title', () => {
    const xast = root(example([
      title([text('My Example')]),
      p([text('Example body.')]),
    ]));
    const output = md(xast);
    expect(output).toContain(':::example[My Example]');
    expect(output).toContain('Example body.');
  });
});

//  Structural container nodes are transparent ─

describe('structural containers (pretext/book/article)', () => {
  it('recurses through book > chapter without emitting a book heading', () => {
    const book = {
      type: 'element' as const,
      name: 'book',
      attributes: {},
      children: [chapter([title([text('Chapter One')]), p([text('Body.')])])],
    } as Element;
    const xast = root(book);
    const result = ptxastToMdast(xast);
    expect(result.children).toHaveLength(2);
    expect(result.children[0]).toMatchObject({ type: 'heading', depth: 1 });
  });

  it('recurses through pretext > article > section', () => {
    const pretext = {
      type: 'element' as const,
      name: 'pretext',
      attributes: {},
      children: [{
        type: 'element' as const,
        name: 'article',
        attributes: {},
        children: [section([title([text('Section')])])],
      }],
    } as Element;
    const xast = root(pretext);
    const output = md(xast);
    expect(output).toContain('## Section');
  });
});

describe('unknown node handling', () => {
  it('skips unknown block element names', () => {
    const figure = { type: 'element' as const, name: 'figure', attributes: {}, children: [] } as Element;
    const xast = root(figure, p([text('After unknown.')]));
    const result = ptxastToMdast(xast);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({ type: 'paragraph' });
  });

  it('skips unknown inline element names', () => {
    const xref = { type: 'element' as const, name: 'xref', attributes: { ref: 'sec-1' }, children: [] } as Element;
    const xast = root(p([text('before '), xref, text(' after')]));
    const result = ptxastToMdast(xast);
    const para = result.children[0] as { children: { value: string }[] };
    expect(para.children).toHaveLength(2);
    expect(para.children[0].value).toBe('before ');
    expect(para.children[1].value).toBe(' after');
  });
});

describe('semantic round-trip (xast -> markdown -> xast)', () => {
  it('preserves major theorem-like and list structure', () => {
    const xast = root(section([
      title([text('Round Trip')]),
      theorem([
        title([text('Key Result')]),
        statement([p([text('If '), em([text('x')]), text(' then '), m('x^2'), text('.')])]),
        proof([p([text('Direct.')])]),
      ], { 'xml:id': 'thm-rt' }),
      ol([
        li([p([text('First')])]),
        li([p([text('Second')])]),
      ]),
    ], { 'xml:id': 'sec-rt' }));

    const markdown = ptxastToMarkdown(xast);
    const reparsed = parseMarkdownToXast(markdown);
    const counts = nodeNameCounts(reparsed);

    expect(counts.get('section')).toBe(1);
    expect(counts.get('theorem')).toBe(1);
    expect(counts.get('statement')).toBe(1);
    expect(counts.get('proof')).toBe(1);
    expect(counts.get('ol')).toBe(1);
    expect(counts.get('li')).toBe(2);
    expect(counts.get('m')).toBe(1);
  });
});

describe('semantic round-trip (xml -> xast -> markdown -> xast)', () => {
  it('preserves core structure and xml:id for theorem-like blocks', () => {
    const xml =
      '<section xml:id="sec-xml"><title>XML Route</title><theorem xml:id="thm-xml"><title>Main</title><statement><p>If <m>x^2</m> then done.</p></statement><proof><p>Direct proof.</p></proof></theorem><ol><li><p>One</p></li><li><p>Two</p></li></ol></section>';

    const parsed = fromXml(xml);
    const markdown = ptxastToMarkdown(parsed);
    const reparsed = parseMarkdownToXast(markdown);
    const counts = nodeNameCounts(reparsed);

    expect(counts.get('section')).toBe(1);
    expect(counts.get('theorem')).toBe(1);
    expect(counts.get('statement')).toBe(1);
    expect(counts.get('proof')).toBe(1);
    expect(counts.get('ol')).toBe(1);
    expect(counts.get('li')).toBe(2);
    expect(counts.get('m')).toBe(1);

    const sectionEl = reparsed.children.find(
      (node) => node.type === 'element' && (node as Element).name === 'section',
    ) as Element | undefined;
    expect(sectionEl?.attributes?.['xml:id']).toBeUndefined();
    if (sectionEl) {
      const theoremEl = sectionEl.children.find(
        (node) => node.type === 'element' && (node as Element).name === 'theorem',
      ) as Element | undefined;
      expect(theoremEl?.attributes?.['xml:id']).toBe('thm-xml');
    }
  });
});
