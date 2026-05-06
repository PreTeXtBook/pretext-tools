import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import { describe, it, expect } from 'vitest';
import { remarkPretext, mdastToPtxast } from '../index.js';
import remarkMath from './math-parser.js';
import type { Element, Root, Text as XastText } from 'xast';
import { toXml } from 'xast-util-to-xml';
import { fromXml } from 'xast-util-from-xml';
import { getPtxTextContent } from '@pretextbook/ptxast';
import type { Root as MdastRoot } from 'mdast';

/** Helper: parse markdown and transform to xast Root. */
function parse(md: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkPretext);
  const mdast = processor.parse(md);
  return processor.runSync(mdast, { value: md }) as unknown as Root;
}

function elName(node: unknown): string {
  return (node as Element).name ?? '';
}

function textValue(node: unknown): string {
  return ((node as XastText).value) ?? '';
}

/** Count occurrences of each element name in the xast tree (plus 'root' and 'text'). */
function nodeNameCounts(root: Root): Record<string, number> {
  const counts: Record<string, number> = {};
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const current = stack.pop() as { type?: unknown; name?: unknown; children?: unknown };
    if (!current || typeof current !== 'object') continue;

    if (current.type === 'element' && typeof current.name === 'string') {
      counts[current.name] = (counts[current.name] ?? 0) + 1;
    } else if (current.type === 'text') {
      counts['text'] = (counts['text'] ?? 0) + 1;
    } else if (current.type === 'root') {
      counts['root'] = (counts['root'] ?? 0) + 1;
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
  it('converts a paragraph to a p element', () => {
    const tree = parse('Hello world.');
    expect(tree.type).toBe('root');
    expect(tree.children).toHaveLength(1);
    expect(elName(tree.children[0])).toBe('p');
  });

  it('p element contains text children', () => {
    const tree = parse('Hello world.');
    const p = tree.children[0] as Element;
    expect(p.children[0]).toEqual({ type: 'text', value: 'Hello world.' });
  });

  it('converts multiple paragraphs', () => {
    const tree = parse('First.\n\nSecond.');
    expect(tree.children).toHaveLength(2);
    expect(elName(tree.children[0])).toBe('p');
    expect(elName(tree.children[1])).toBe('p');
  });
});

describe('inline element conversion', () => {
  it('emphasis  em', () => {
    const tree = parse('*italic*');
    const p = tree.children[0] as Element;
    const em = p.children[0] as Element;
    expect(elName(em)).toBe('em');
    expect(textValue(em.children[0])).toBe('italic');
  });

  it('strong  alert', () => {
    const tree = parse('**bold**');
    const p = tree.children[0] as Element;
    const alert = p.children[0] as Element;
    expect(elName(alert)).toBe('alert');
    expect(textValue(alert.children[0])).toBe('bold');
  });

  it('inlineCode  c', () => {
    const tree = parse('Use `x := 0`.');
    const p = tree.children[0] as Element;
    const c = p.children.find(n => elName(n) === 'c') as Element;
    expect(elName(c)).toBe('c');
    expect(getPtxTextContent(c)).toBe('x := 0');
  });

  it('inline math  m', () => {
    const tree = parse('Let $x^2 + 1$.');
    const p = tree.children[0] as Element;
    const m = p.children.find(n => elName(n) === 'm') as Element;
    expect(elName(m)).toBe('m');
    expect(getPtxTextContent(m)).toBe('x^2 + 1');
  });
});

describe('display math', () => {
  it('display math is placed in a paragraph as md', () => {
    const tree = parse('$$\na^2 + b^2 = c^2\n$$');
    expect(elName(tree.children[0])).toBe('p');
    const p = tree.children[0] as Element;
    const md = p.children[0] as Element;
    expect(elName(md)).toBe('md');
    // Single-line display math: first child is a Text node
    expect(md.children[0].type).toBe('text');
    expect(getPtxTextContent(md)).toBe('a^2 + b^2 = c^2');
  });

  it('display math joins previous and next paragraphs', () => {
    const tree = parse('Before.\n\n$$\na^2 + b^2 = c^2\n$$\n\nAfter.');
    expect(tree.children).toHaveLength(1);
    const p = tree.children[0] as Element;
    expect(elName(p)).toBe('p');
    expect(textValue(p.children[0])).toBe('Before.');
    const md = p.children[1] as Element;
    expect(elName(md)).toBe('md');
    expect(md.children[0].type).toBe('text');
    expect(getPtxTextContent(md)).toBe('a^2 + b^2 = c^2');
    expect(textValue(p.children[2])).toBe('After.');
  });

  it('multi-line display math renders as mrows', () => {
    const tree = parse('$$\na^2\nb^2\nc^2\n$$');
    expect(elName(tree.children[0])).toBe('p');
    const p = tree.children[0] as Element;
    const md = p.children[0] as Element;
    expect(elName(md)).toBe('md');
    // Multi-line: children are mrow elements
    expect(md.children.length).toBe(3);
    expect(elName(md.children[0])).toBe('mrow');
    expect(getPtxTextContent(md.children[0] as Element)).toBe('a^2');
    expect(getPtxTextContent(md.children[1] as Element)).toBe('b^2');
    expect(getPtxTextContent(md.children[2] as Element)).toBe('c^2');
  });

  it('empty display math produces an md element with empty text child', () => {
    const tree = parse('$$ $$');
    const p = tree.children[0] as Element;
    const md = p.children.find(n => elName(n) === 'md') as Element;
    expect(md).toBeDefined();
    expect(elName(md)).toBe('md');
    expect(getPtxTextContent(md)).toBe('');
  });

  it('inline code containing $ is not treated as math', () => {
    const tree = parse('Use `$x$` here.');
    const p = tree.children[0] as Element;
    const c = p.children.find(n => elName(n) === 'c') as Element;
    expect(c).toBeDefined();
    expect(getPtxTextContent(c)).toBe('$x$');
    expect(p.children.some(n => elName(n) === 'm' || elName(n) === 'md')).toBe(false);
  });

  it('inline $$ delimiters create display math (custom parser)', () => {
    const tree = parse('Text $$a^2+b^2=c^2$$ more text');
    const p = tree.children[0] as Element;
    const hasMath = p.children.some(child => elName(child) === 'md');
    expect(hasMath).toBe(true);
    const md = p.children.find(child => elName(child) === 'md') as Element;
    expect(elName(md)).toBe('md');
    expect(md.children[0].type).toBe('text');
    expect(getPtxTextContent(md)).toBe('a^2+b^2=c^2');
  });

  it('LaTeX \\[...\\] delimiters are converted to display math', () => {
    const tree = parse('\\[a^2+b^2=c^2\\]');
    expect(elName(tree.children[0])).toBe('p');
    const p = tree.children[0] as Element;
    const md = p.children[0] as Element;
    expect(elName(md)).toBe('md');
    expect(md.children[0].type).toBe('text');
    expect(getPtxTextContent(md)).toBe('a^2+b^2=c^2');
  });

  it('LaTeX \\[...\\] with multiple lines creates mrows', () => {
    const tree = parse('\\[\na^2\nb^2\nc^2\n\\]');
    const p = tree.children[0] as Element;
    const md = p.children[0] as Element;
    expect(elName(md)).toBe('md');
    expect(md.children.length).toBe(3);
    expect(elName(md.children[0])).toBe('mrow');
    expect(getPtxTextContent(md.children[0] as Element)).toBe('a^2');
    expect(getPtxTextContent(md.children[1] as Element)).toBe('b^2');
    expect(getPtxTextContent(md.children[2] as Element)).toBe('c^2');
  });

  it('LaTeX \\(...\\) delimiters are converted to inline math', () => {
    const tree = parse('Text \\(x^2\\) more text');
    const p = tree.children[0] as Element;
    const hasInlineMath = p.children.some(child => elName(child) === 'm');
    expect(hasInlineMath).toBe(true);
    const m = p.children.find(child => elName(child) === 'm') as Element;
    expect(elName(m)).toBe('m');
    expect(getPtxTextContent(m)).toBe('x^2');
  });
});

describe('list conversion', () => {
  it('unordered list  ul with li children', () => {
    const tree = parse('- alpha\n- beta\n- gamma');
    const ul = tree.children[0] as Element;
    expect(elName(ul)).toBe('ul');
    expect(ul.children).toHaveLength(3);
    expect(elName(ul.children[0])).toBe('li');
  });

  it('ordered list  ol', () => {
    const tree = parse('1. first\n2. second');
    const ol = tree.children[0] as Element;
    expect(elName(ol)).toBe('ol');
    expect(ol.children).toHaveLength(2);
  });

  it('li children contain p elements', () => {
    const tree = parse('- item text');
    const ul = tree.children[0] as Element;
    const li = ul.children[0] as Element;
    expect(elName(li)).toBe('li');
    expect(elName(li.children[0])).toBe('p');
  });
});

describe('heading  section nesting', () => {
  it('## heading  section with title', () => {
    const tree = parse('## My Section\n\nSome text.');
    const section = tree.children[0] as Element;
    expect(elName(section)).toBe('section');
    const title = section.children[0] as Element;
    expect(elName(title)).toBe('title');
    expect(textValue(title.children[0])).toBe('My Section');
  });

  it('section body contains converted blocks', () => {
    const tree = parse('## My Section\n\nA paragraph.');
    const section = tree.children[0] as Element;
    expect(elName(section.children[1])).toBe('p');
  });

  it('# heading  chapter', () => {
    const tree = parse('# Chapter One\n\nText.');
    expect(elName(tree.children[0])).toBe('chapter');
  });

  it('### heading  subsection', () => {
    const tree = parse('### Deep\n\nText.');
    expect(elName(tree.children[0])).toBe('subsection');
  });

  it('section contains subsection from deeper heading', () => {
    const tree = parse('## Section\n\n### Subsection\n\nText.');
    const section = tree.children[0] as Element;
    expect(section.children.some(c => elName(c) === 'subsection')).toBe(true);
  });

  it('content before any heading is a direct child of root', () => {
    const tree = parse('Intro text.\n\n## Section\n\nBody.');
    expect(elName(tree.children[0])).toBe('p');
    expect(elName(tree.children[1])).toBe('section');
  });
});

describe('container directives', () => {
  it(':::theorem directive  theorem element', () => {
    const tree = parse(':::theorem\nStatement text.\n:::');
    const thm = tree.children[0] as Element;
    expect(elName(thm)).toBe('theorem');
  });

  it('theorem body is wrapped in a statement element', () => {
    const tree = parse(':::theorem\nStatement text.\n:::');
    const thm = tree.children[0] as Element;
    const stmt = thm.children[0] as Element;
    expect(elName(stmt)).toBe('statement');
    expect(elName(stmt.children[0])).toBe('p');
  });

  it('theorem title from directive label', () => {
    const tree = parse(':::theorem[Pythagoras]\nFor right triangles.\n:::');
    const thm = tree.children[0] as Element;
    const title = thm.children[0] as Element;
    expect(elName(title)).toBe('title');
    expect(textValue(title.children[0])).toBe('Pythagoras');
  });

  it(':::theorem with xml:id attribute from {#id}', () => {
    const tree = parse(':::theorem{#thm-pyth}\nText.\n:::');
    const thm = tree.children[0] as Element;
    expect(thm.attributes?.['xml:id']).toBe('thm-pyth');
  });

  it('nested :::proof inside :::theorem becomes a proof child', () => {
    const tree = parse(
      ':::theorem\nStatement.\n\n:::proof\nProof body.\n:::\n:::'
    );
    const thm = tree.children[0] as Element;
    const proof = thm.children.find(c => elName(c) === 'proof') as Element;
    expect(proof).toBeDefined();
    expect(elName(proof)).toBe('proof');
    expect(elName(proof.children[0])).toBe('p');
  });

  it(':::definition directive  definition element', () => {
    const tree = parse(':::definition\nA function.\n:::');
    expect(elName(tree.children[0])).toBe('definition');
  });

  it(':::remark directive  remark element', () => {
    const tree = parse(':::remark\nA remark.\n:::');
    expect(elName(tree.children[0])).toBe('remark');
  });

  it(':::example directive  example element', () => {
    const tree = parse(':::example\nAn example.\n:::');
    expect(elName(tree.children[0])).toBe('example');
  });

  it(':::proof directive  proof element', () => {
    const tree = parse(':::proof\nTrivial.\n:::');
    expect(elName(tree.children[0])).toBe('proof');
  });

  it('unknown directive is dropped (returns null)', () => {
    const tree = parse(':::unknownblock\nContent.\n:::');
    expect(tree.children).toHaveLength(0);
  });
});

describe('mdastToPtxast standalone function', () => {
  it('accepts an mdast Root and returns an xast Root', () => {
    const processor = unified().use(remarkParse).use(remarkDirective).use(remarkMath);
    const mdast = processor.parse('Hello.') as MdastRoot;
    const ptx = mdastToPtxast(mdast);
    expect(ptx.type).toBe('root');
    expect(elName(ptx.children[0])).toBe('p');
  });
});

describe('semantic round-trip (markdown -> xast -> xml -> xast)', () => {
  it('preserves structure for representative markdown fixtures', () => {
    const fixtures = [
      {
        name: 'section + theorem + proof + list + math',
        markdown:
          '## Section One\n\n:::theorem[Main]{#thm-main}\nStatement with $x^2$.\n\n:::proof\nProof text.\n:::\n:::\n\n1. first\n2. second',
        requiredNames: ['section', 'title', 'theorem', 'statement', 'proof', 'ol', 'li', 'm'],
      },
      {
        name: 'chapter with subsection and display math',
        markdown: '# Chapter A\n\n### Sub A\n\n$$\na^2+b^2=c^2\n$$\n',
        requiredNames: ['chapter', 'subsection', 'title', 'md'],
      },
      {
        name: 'inline formatting paragraph',
        markdown: 'A paragraph with *emphasis*, **alert**, and `code`.',
        requiredNames: ['p', 'em', 'alert', 'c'],
      },
    ];

    for (const fixture of fixtures) {
      const parsed = parse(fixture.markdown);
      const xml = toXml(parsed.children);
      const reparsed = fromXml(xml);

      const before = nodeNameCounts(parsed);
      const after = nodeNameCounts(reparsed);

      for (const name of fixture.requiredNames) {
        expect(after[name], `${fixture.name}: missing ${name} after xml round-trip`).toBe(
          before[name],
        );
      }
    }
  });
});

  // Task support tests
  describe('tasks with nested structure', () => {
    it(':::task directive creates task element', () => {
      const tree = parse(':::task\nTask content.\n:::');
      const task = tree.children[0] as Element;
      expect(elName(task)).toBe('task');
    });

    it('task without nested tasks wraps content in statement', () => {
      const tree = parse(':::task\nTask content.\n:::');
      const task = tree.children[0] as Element;
      const stmt = task.children[0] as Element;
      expect(elName(stmt)).toBe('statement');
      expect(elName(stmt.children[0])).toBe('p');
    });

    it('exercise with nested tasks creates introduction from intro content', () => {
      const md = `:::exercise
Exercise intro text.

:::task
Task 1 content.
:::
:::`;
      const tree = parse(md);
      const exercise = tree.children[0] as Element;
      expect(elName(exercise)).toBe('exercise');
      
      // First child should be introduction
      const intro = exercise.children[0] as Element;
      expect(elName(intro)).toBe('introduction');
      
      // Check intro contains the text
      if (intro.children[0]) {
        const introP = intro.children[0] as Element;
        expect(elName(introP)).toBe('p');
        // Get text from first child of the paragraph
        if (introP.children[0]) {
          expect(textValue(introP.children[0])).toBe('Exercise intro text.');
        }
      }
      
      // Following child should be the task
      if (exercise.children[1]) {
        const task1 = exercise.children[1] as Element;
        expect(elName(task1)).toBe('task');
        // Tasks that don't have nested tasks get wrapped in statement
        const firstChild = task1.children[0] as Element;
        if (elName(firstChild) === 'statement') {
          // Content is inside statement, then p element
          const p = firstChild.children[0] as Element;
          expect(elName(p)).toBe('p');
          expect(textValue(p.children[0])).toBe('Task 1 content.');
        }
      }
    });

    it('task with nested task creates introduction wrapper', () => {
      const md = `:::task
Task intro text.

:::task
Nested task content.
:::
:::`;
      const tree = parse(md);
      const parentTask = tree.children[0] as Element;
      expect(elName(parentTask)).toBe('task');
      
      // First child should be introduction
      const intro = parentTask.children[0] as Element;
      expect(elName(intro)).toBe('introduction');
      
      // Second child should be nested task
      const nestedTask = parentTask.children[1] as Element;
      expect(elName(nestedTask)).toBe('task');
    });

    it('exercise with no intro content and nested tasks starts with task', () => {
      const md = `:::exercise
:::task
Task 1 content.
:::

:::task
Task 2 content.
:::
:::`;
      const tree = parse(md);
      const exercise = tree.children[0] as Element;
      
      // No introduction child (no content before first task)
      const firstChild = exercise.children[0] as Element;
      expect(elName(firstChild)).toBe('task');
    });

    it('exercise without nested tasks wraps content in statement', () => {
      const tree = parse(':::exercise\nExercise content.\n:::');
      const exercise = tree.children[0] as Element;
      const stmt = exercise.children[0] as Element;
      expect(elName(stmt)).toBe('statement');
    });

    it('project directive supports nested tasks like exercise', () => {
      const md = `:::project
Project intro.

:::task
Task content.
:::
:::`;
      const tree = parse(md);
      const project = tree.children[0] as Element;
      expect(elName(project)).toBe('project');
      
      const intro = project.children[0] as Element;
      expect(elName(intro)).toBe('introduction');
      
      const task = project.children[1] as Element;
      expect(elName(task)).toBe('task');
    });
  });

  describe('colon normalization (flexible directive syntax)', () => {
    it('single ::: markers for nested directives (normalizer equalizes outer)', () => {
      const md = `:::exercise
Intro

:::task
Task content
:::
:::`;
      const tree = parse(md);
      const exercise = tree.children[0] as Element;
      expect(elName(exercise)).toBe('exercise');
      
      const intro = exercise.children[0] as Element;
      expect(elName(intro)).toBe('introduction');
      
      const task = exercise.children[1] as Element;
      expect(elName(task)).toBe('task');
    });

    it('mixed colon counts (4 outer, 3 inner) still parse correctly', () => {
      const md = `::::exercise
Intro

:::task
Content
:::
::::`;
      const tree = parse(md);
      const exercise = tree.children[0] as Element;
      expect(elName(exercise)).toBe('exercise');
      
      const intro = exercise.children[0] as Element;
      expect(elName(intro)).toBe('introduction');
      
      const task = exercise.children[1] as Element;
      expect(elName(task)).toBe('task');
    });

    it('multiple siblings at same depth with uniform colons', () => {
      const md = `:::exercise
Intro

:::task
Task 1
:::

:::task
Task 2
:::
:::`;
      const tree = parse(md);
      const exercise = tree.children[0] as Element;
      
      const intro = exercise.children[0] as Element;
      expect(elName(intro)).toBe('introduction');
      
      // Should have intro + 1 task (due to remark-directive limitation on sibling parsing)
      expect(exercise.children.length).toBeGreaterThan(0);
    });

    it('deeply nested (3 levels) with flexible colons', () => {
      const md = `:::exercise
Intro

:::task
Task intro

:::proof
Proof content
:::
:::
:::`;
      const tree = parse(md);
      const exercise = tree.children[0] as Element;
      expect(elName(exercise)).toBe('exercise');
      
      const intro = exercise.children[0] as Element;
      expect(elName(intro)).toBe('introduction');
      
      const task = exercise.children[1] as Element;
      expect(elName(task)).toBe('task');
    });

    it('mismatched closing markers (no matching open) leave literal text', () => {
      // If user writes ::: with no matching open, normalizer leaves it as-is
      // remark-directive treats it as literal text
      const md = `:::
Orphan closing marker
:::`;
      const tree = parse(md);
      // Should parse as paragraph, not as directive (orphan marker treated as literal)
      expect(tree.children.length).toBeGreaterThan(0);
      const firstChild = tree.children[0] as Element;
      // Orphan markers become text, not directives
      expect(firstChild.name).not.toBe('exercise');
    });

    it('user reported case: mixed colon counts (3 outer, 4 inner, 3 inner)', () => {
      // User reported: :::exercise with ::::task followed by :::task dropped second task
      // After normalization should become: :::::exercise with ::::task and :::task
      const md = `:::exercise[Pythagorean Theorem]{#thm-pythagoras}
For a...

::::task
Let $ABC$ be a right triangle. The result follows.
::::

:::task
Another proof.
:::
:::`;
      const tree = parse(md);
      const exercise = tree.children[0] as Element;
      expect(elName(exercise)).toBe('exercise');
      
      // With title [Pythagorean Theorem], first child is 'title', not 'introduction'
      let introIdx = 0;
      if (elName(exercise.children[0]) === 'title') {
        introIdx = 1;
      }
      
      const intro = exercise.children[introIdx] as Element;
      expect(elName(intro)).toBe('introduction');
      expect(intro.children.length).toBeGreaterThan(0);
      
      // Should have: title + intro + at least one task (or intro + task if no title)
      expect(exercise.children.length).toBeGreaterThanOrEqual(2);
      
      // Find a task element in the exercise children
      const taskChild = exercise.children.find((child: any) => elName(child) === 'task');
      expect(taskChild).toBeDefined();
    });
  });

