import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import { describe, it, expect } from 'vitest';
import { remarkPretext, mdastToPtxast } from '../index.js';
import remarkMath from './math-parser.js';
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
  Md,
  Ol,
  Ul,
  Li,
  Title,
  Statement,
  Proof,
  Theorem,
} from '@pretextbook/ptxast';
import { ptxastRootToXml } from '@pretextbook/ptxast-util-to-xml';
import { ptxastFromXml } from '@pretextbook/ptxast-util-from-xml';
import type { Root as MdastRoot } from 'mdast';

/** Helper: parse markdown and transform to ptxast. */
function parse(md: string): PtxRoot {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkPretext);
  const mdast = processor.parse(md);
  return processor.runSync(mdast, { value: md }) as unknown as PtxRoot;
}

function nodeTypeCounts(root: PtxRoot): Record<string, number> {
  const counts: Record<string, number> = {};
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const current = stack.pop() as { type?: unknown; children?: unknown };
    if (!current || typeof current !== 'object') continue;

    if (typeof current.type === 'string') {
      counts[current.type] = (counts[current.type] ?? 0) + 1;
    }

    if (Array.isArray(current.children)) {
      for (let i = current.children.length - 1; i >= 0; i -= 1) {
        stack.push(current.children[i]);
      }
    }
  }

  return counts;
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
  it('display math is placed in a paragraph as md', () => {
    const tree = parse('$$\na^2 + b^2 = c^2\n$$');
    expect(tree.children[0].type).toBe('p');
    const p = tree.children[0] as P;
    const md = p.children[0] as Md;
    expect(md.type).toBe('md');
    // Single-line display math has value, not children
    expect('value' in md).toBe(true);
    expect((md as { value: string }).value).toBe('a^2 + b^2 = c^2');
  });

  it('display math joins previous and next paragraphs', () => {
     const tree = parse('Before.\n\n$$\na^2 + b^2 = c^2\n$$\n\nAfter.');
      expect(tree.children).toHaveLength(1);
      const p = tree.children[0] as P;
      expect(p.type).toBe('p');
      expect((p.children[0] as PtxText).value).toBe('Before.');
      const md = p.children[1] as Md;
     expect(md.type).toBe('md');
     expect('value' in md).toBe(true);
      expect((md as { value: string }).value).toBe('a^2 + b^2 = c^2');
      expect((p.children[2] as PtxText).value).toBe('After.');
  });

  it('multi-line display math renders as mrows', () => {
    const tree = parse('$$\na^2\nb^2\nc^2\n$$');
    expect(tree.children[0].type).toBe('p');
    const p = tree.children[0] as P;
    const md = p.children[0] as Md;
    expect(md.type).toBe('md');
    // Multi-line display math has children (mrows), not a single value
    expect('children' in md).toBe(true);
    expect((md as { children: { value: string }[] }).children).toHaveLength(3);
    expect((md as { children: { value: string }[] }).children[0].value).toBe('a^2');
    expect((md as { children: { value: string }[] }).children[1].value).toBe('b^2');
    expect((md as { children: { value: string }[] }).children[2].value).toBe('c^2');
  });

  it('empty display math produces an md node with empty string value', () => {
    // $$ $$ has only whitespace content – rows is empty after filtering
    const tree = parse('$$ $$');
    const p = tree.children[0] as P;
    const md = p.children.find(n => n.type === 'md') as Md;
    expect(md).toBeDefined();
    expect(md.type).toBe('md');
    expect('value' in md).toBe(true);
    expect((md as { value: string }).value).toBe('');
  });

  it('inline code containing $ is not treated as math', () => {
    const tree = parse('Use `$x$` here.');
    const p = tree.children[0] as P;
    const c = p.children.find(n => n.type === 'c') as C;
    expect(c).toBeDefined();
    // The code node value must be the original content, not a leaked token
    expect(c.value).toBe('$x$');
    // No math nodes should be present
    expect(p.children.some(n => n.type === 'm' || n.type === 'md')).toBe(false);
  });

  it('inline $$ delimiters create display math (custom parser)', () => {
     // Note: In our custom parser, $$ always creates display math (meta:'display')
     // even when used inline. This is standard LaTeX/PreTeXt convention.
     // Use single $ for inline math.
    const tree = parse('Text $$a^2+b^2=c^2$$ more text');
    const p = tree.children[0] as P;
     const hasMath = p.children.some(child => child.type === 'md');
    expect(hasMath).toBe(true);
     const md = p.children.find(child => child.type === 'md') as Md;
     expect(md?.type).toBe('md');
     expect('value' in md).toBe(true);
    expect((md as { value: string }).value).toBe('a^2+b^2=c^2');
  });

  it('LaTeX \\[...\\] delimiters are converted to display math', () => {
    const tree = parse('\\[a^2+b^2=c^2\\]');
    expect(tree.children[0].type).toBe('p');
    const p = tree.children[0] as P;
    const md = p.children[0] as Md;
    expect(md.type).toBe('md');
    expect('value' in md).toBe(true);
    expect((md as { value: string }).value).toBe('a^2+b^2=c^2');
  });

  it('LaTeX \\[...\\] with multiple lines creates mrows', () => {
    const tree = parse('\\[\na^2\nb^2\nc^2\n\\]');
    const p = tree.children[0] as P;
    const md = p.children[0] as Md;
    expect(md.type).toBe('md');
    expect('children' in md).toBe(true);
    expect((md as { children: { value: string }[] }).children).toHaveLength(3);
    expect((md as { children: { value: string }[] }).children[0].value).toBe('a^2');
    expect((md as { children: { value: string }[] }).children[1].value).toBe('b^2');
    expect((md as { children: { value: string }[] }).children[2].value).toBe('c^2');
  });

  it('LaTeX \\(...\\) delimiters are converted to inline math', () => {
    const tree = parse('Text \\(x^2\\) more text');
    const p = tree.children[0] as P;
    const hasInlineMath = p.children.some(child => child.type === 'm');
    expect(hasInlineMath).toBe(true);
    const m = p.children.find(child => child.type === 'm') as M;
    expect(m.type).toBe('m');
    expect(m.value).toBe('x^2');
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
    expect(tree.children).toHaveLength(0);
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

describe('semantic round-trip (markdown -> ptxast -> xml -> ptxast)', () => {
  it('preserves structure for representative markdown fixtures', () => {
    const fixtures = [
      {
        name: 'section + theorem + proof + list + math',
        markdown:
          '## Section One\n\n:::theorem[Main]{#thm-main}\nStatement with $x^2$.\n\n:::proof\nProof text.\n:::\n:::\n\n1. first\n2. second',
        requiredTypes: ['section', 'title', 'theorem', 'statement', 'proof', 'ol', 'li', 'm'],
      },
      {
        name: 'chapter with subsection and display math',
        markdown: '# Chapter A\n\n### Sub A\n\n$$\na^2+b^2=c^2\n$$\n',
        requiredTypes: ['chapter', 'subsection', 'title', 'md'],
      },
      {
        name: 'inline formatting paragraph',
        markdown: 'A paragraph with *emphasis*, **alert**, and `code`.',
        requiredTypes: ['p', 'em', 'alert', 'c'],
      },
    ];

    for (const fixture of fixtures) {
      const parsed = parse(fixture.markdown);
      const xml = ptxastRootToXml(parsed);
      const reparsed = ptxastFromXml(xml);

      const before = nodeTypeCounts(parsed);
      const after = nodeTypeCounts(reparsed);

      for (const t of fixture.requiredTypes) {
        expect(after[t], `${fixture.name}: missing ${t} after xml round-trip`).toBe(
          before[t],
        );
      }
    }
  });
});
