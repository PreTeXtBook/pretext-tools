/**
 * Tests for ptxast-to-mdast and ptxastToMarkdown.
 *
 * Strategy: build ptxast nodes by hand (using the builders from @pretextbook/ptxast),
 * convert them, and assert on the resulting mdast structure OR the rendered markdown.
 */

import { describe, it, expect } from 'vitest';
import { ptxastToMdast } from './ptxast-to-mdast.js';
import { ptxastToMarkdown } from './ptxast-util-to-mdast.js';
import type { PtxRoot } from '@pretextbook/ptxast';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Render ptxast to markdown and normalize whitespace for snapshot comparisons. */
function md(root: PtxRoot): string {
  return ptxastToMarkdown(root).trim();
}

// ─── Plain text & paragraphs ─────────────────────────────────────────────────

describe('paragraphs and inline', () => {
  it('converts a simple paragraph', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        { type: 'p', children: [{ type: 'text', value: 'Hello world' }] },
      ],
    };
    const result = ptxastToMdast(root);
    expect(result.type).toBe('root');
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({ type: 'paragraph' });
  });

  it('converts em (emphasis)', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'p',
          children: [
            { type: 'text', value: 'See ' },
            { type: 'em', children: [{ type: 'text', value: 'this' }] },
          ],
        },
      ],
    };
    expect(md(root)).toBe('See *this*');
  });

  it('converts alert (strong)', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        { type: 'p', children: [{ type: 'alert', children: [{ type: 'text', value: 'Warning' }] }] },
      ],
    };
    expect(md(root)).toContain('**Warning**');
  });

  it('converts inline code (c)', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        { type: 'p', children: [{ type: 'c', value: 'npm install' }] },
      ],
    };
    expect(md(root)).toContain('`npm install`');
  });

  it('converts inline math (m)', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        { type: 'p', children: [{ type: 'm', value: 'x^2' }] },
      ],
    };
    expect(md(root)).toContain('$x^2$');
  });
});

// ─── Display math ─────────────────────────────────────────────────────────────

describe('display math', () => {
  it('converts me to display math block', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{ type: 'me', value: 'a^2 + b^2 = c^2' }],
    };
    const result = ptxastToMdast(root);
    expect(result.children[0]).toMatchObject({ type: 'math', value: 'a^2 + b^2 = c^2' });
    expect(md(root)).toContain('$$');
    expect(md(root)).toContain('a^2 + b^2 = c^2');
  });

  it('converts men to display math block', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{ type: 'men', value: 'e = mc^2' }],
    };
    expect(ptxastToMdast(root).children[0]).toMatchObject({ type: 'math' });
  });
});

// ─── Lists ────────────────────────────────────────────────────────────────────

describe('lists', () => {
  it('converts ul to unordered list', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'ul',
          children: [
            { type: 'li', children: [{ type: 'p', children: [{ type: 'text', value: 'Alpha' }] }] },
            { type: 'li', children: [{ type: 'p', children: [{ type: 'text', value: 'Beta' }] }] },
          ],
        },
      ],
    };
    const result = ptxastToMdast(root);
    expect(result.children[0]).toMatchObject({ type: 'list', ordered: false });
    const output = md(root);
    expect(output).toContain('* Alpha');
    expect(output).toContain('* Beta');
  });

  it('converts ol to ordered list', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'ol',
          children: [
            { type: 'li', children: [{ type: 'p', children: [{ type: 'text', value: 'First' }] }] },
            { type: 'li', children: [{ type: 'p', children: [{ type: 'text', value: 'Second' }] }] },
          ],
        },
      ],
    };
    const result = ptxastToMdast(root);
    expect(result.children[0]).toMatchObject({ type: 'list', ordered: true });
  });
});

// ─── Code / program ───────────────────────────────────────────────────────────

describe('program', () => {
  it('converts program to fenced code with language', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{ type: 'program', value: 'x = 1', attributes: { language: 'python' } }],
    };
    const output = md(root);
    expect(output).toContain('```python');
    expect(output).toContain('x = 1');
  });

  it('converts program without language', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [{ type: 'program', value: 'hello' }],
    };
    expect(md(root)).toContain('```');
  });
});

// ─── Divisions → headings ─────────────────────────────────────────────────────

describe('divisions', () => {
  it('converts a section to a depth-2 heading', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'section',
          attributes: { 'xml:id': 'sec-intro' },
          children: [
            { type: 'title', children: [{ type: 'text', value: 'Introduction' }] },
            { type: 'p', children: [{ type: 'text', value: 'Body text.' }] },
          ],
        },
      ],
    };
    const result = ptxastToMdast(root);
    expect(result.children[0]).toMatchObject({ type: 'heading', depth: 2 });
    const h = result.children[0] as { type: string; depth: number; children: { value: string }[] };
    expect(h.children[0].value).toBe('Introduction');
    expect(result.children[1]).toMatchObject({ type: 'paragraph' });
    const output = md(root);
    expect(output).toContain('## Introduction');
    expect(output).toContain('Body text.');
  });

  it('converts nested section/subsection to headings at correct depths', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'section',
          children: [
            { type: 'title', children: [{ type: 'text', value: 'Section' }] },
            {
              type: 'subsection',
              children: [
                { type: 'title', children: [{ type: 'text', value: 'Sub' }] },
                { type: 'p', children: [{ type: 'text', value: 'Content.' }] },
              ],
            },
          ],
        },
      ],
    };
    const output = md(root);
    expect(output).toContain('## Section');
    expect(output).toContain('### Sub');
  });

  it('preserves xml:id as heading data', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'section',
          attributes: { 'xml:id': 'sec-main' },
          children: [{ type: 'title', children: [{ type: 'text', value: 'Main' }] }],
        },
      ],
    };
    const result = ptxastToMdast(root);
    const heading = result.children[0] as { data?: { id?: string } };
    expect(heading.data?.id).toBe('sec-main');
  });

  it('converts chapter to depth-1 heading', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'chapter',
          children: [{ type: 'title', children: [{ type: 'text', value: 'Chapter One' }] }],
        },
      ],
    };
    const result = ptxastToMdast(root);
    expect(result.children[0]).toMatchObject({ type: 'heading', depth: 1 });
    expect(md(root)).toContain('# Chapter One');
  });
});

// ─── Theorem-like directives ──────────────────────────────────────────────────

describe('theorem-like blocks', () => {
  it('converts theorem with title and statement to container directive', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'theorem',
          attributes: { 'xml:id': 'thm-pyth' },
          children: [
            { type: 'title', children: [{ type: 'text', value: 'Pythagorean Theorem' }] },
            {
              type: 'statement',
              children: [
                { type: 'p', children: [{ type: 'text', value: 'For a right triangle.' }] },
              ],
            },
          ],
        },
      ],
    };
    const result = ptxastToMdast(root);
    expect(result.children[0]).toMatchObject({ type: 'containerDirective', name: 'theorem' });
    const output = md(root);
    expect(output).toContain(':::theorem[Pythagorean Theorem]{#thm-pyth}');
    expect(output).toContain('For a right triangle.');
  });

  it('converts theorem with nested proof', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'theorem',
          children: [
            {
              type: 'statement',
              children: [{ type: 'p', children: [{ type: 'text', value: 'The claim.' }] }],
            },
            {
              type: 'proof',
              children: [{ type: 'p', children: [{ type: 'text', value: 'The proof.' }] }],
            },
          ],
        },
      ],
    };
    const output = md(root);
    expect(output).toContain('::::theorem');
    expect(output).toContain(':::proof');
    expect(output).toContain('The proof.');
  });

  it('converts definition (definition-like) with statement', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'definition',
          children: [
            { type: 'title', children: [{ type: 'text', value: 'Prime' }] },
            {
              type: 'statement',
              children: [{ type: 'p', children: [{ type: 'text', value: 'A prime number.' }] }],
            },
          ],
        },
      ],
    };
    const output = md(root);
    expect(output).toContain(':::definition[Prime]');
    expect(output).toContain('A prime number.');
  });
});

// ─── Remark-like / proof-like directives ─────────────────────────────────────

describe('remark-like and proof-like blocks', () => {
  it('converts proof without statement wrapper', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'proof',
          children: [
            { type: 'p', children: [{ type: 'text', value: 'QED.' }] },
          ],
        },
      ],
    };
    const result = ptxastToMdast(root);
    expect(result.children[0]).toMatchObject({ type: 'containerDirective', name: 'proof' });
    expect(md(root)).toContain(':::proof');
    expect(md(root)).toContain('QED.');
  });

  it('converts remark block', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'remark',
          children: [{ type: 'p', children: [{ type: 'text', value: 'Note this.' }] }],
        },
      ],
    };
    expect(md(root)).toContain(':::remark');
  });

  it('converts example block with title', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'example',
          children: [
            { type: 'title', children: [{ type: 'text', value: 'My Example' }] },
            { type: 'p', children: [{ type: 'text', value: 'Example body.' }] },
          ],
        },
      ],
    };
    const output = md(root);
    expect(output).toContain(':::example[My Example]');
    expect(output).toContain('Example body.');
  });
});

// ─── Structural container nodes are transparent ───────────────────────────────

describe('structural containers (pretext/book/article)', () => {
  it('recurses through book > chapter without emitting a book heading', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'book' as unknown as import('@pretextbook/ptxast').PtxContent['type'],
          children: [
            {
              type: 'chapter',
              children: [
                { type: 'title', children: [{ type: 'text', value: 'Chapter One' }] },
                { type: 'p', children: [{ type: 'text', value: 'Body.' }] },
              ],
            },
          ],
        } as unknown as import('@pretextbook/ptxast').PtxContent,
      ],
    };
    const result = ptxastToMdast(root);
    // Should produce heading + paragraph, not be empty
    expect(result.children).toHaveLength(2);
    expect(result.children[0]).toMatchObject({ type: 'heading', depth: 1 });
  });

  it('recurses through pretext > article > section', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'pretext',
          children: [
            {
              type: 'article',
              children: [
                {
                  type: 'section',
                  children: [
                    { type: 'title', children: [{ type: 'text', value: 'Section' }] },
                  ],
                },
              ],
            },
          ],
        } as unknown as import('@pretextbook/ptxast').PtxContent,
      ],
    };
    const output = md(root);
    expect(output).toContain('## Section');
  });
});



describe('unknown node handling', () => {
  it('skips unknown block node types', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        { type: 'figure' } as unknown as import('@pretextbook/ptxast').PtxContent,
        { type: 'p', children: [{ type: 'text', value: 'After unknown.' }] },
      ],
    };
    const result = ptxastToMdast(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({ type: 'paragraph' });
  });

  it('skips unknown inline node types', () => {
    const root: PtxRoot = {
      type: 'root',
      children: [
        {
          type: 'p',
          children: [
            { type: 'text', value: 'before ' },
            { type: 'xref' } as unknown as import('@pretextbook/ptxast').PtxContent,
            { type: 'text', value: ' after' },
          ],
        },
      ],
    };
    const result = ptxastToMdast(root);
    const para = result.children[0] as { children: { value: string }[] };
    expect(para.children).toHaveLength(2);
    expect(para.children[0].value).toBe('before ');
    expect(para.children[1].value).toBe(' after');
  });
});
