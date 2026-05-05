/**
 * ptxast-to-mdast: converts an xast Root (PreTeXt document) into an mdast Root.
 *
 * Division nodes (section/subsection/etc.) are flattened back to headings.
 * PreTeXt block environments (theorem/proof/definition/etc.) become
 * container directives (`:::theorem[Title]{#id}` syntax).
 *
 * The resulting mdast can be serialized to markdown using `ptxastToMarkdown`,
 * which passes the directive and math extensions to `mdast-util-to-markdown`.
 */

import type {
  Root as MdastRoot,
  Content as MdastContent,
  BlockContent,
  DefinitionContent,
  PhrasingContent,
  Paragraph,
  Heading,
  Text,
  Emphasis,
  Strong,
  InlineCode,
  List,
  ListItem,
  Code,
  Blockquote as MdastBlockquote,
} from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import type { Math as MdastMath, InlineMath } from 'mdast-util-math';
import type { Root, Element, ElementContent } from 'xast';
import { getPtxTextContent } from '@pretextbook/ptxast';

// ---------------------------------------------------------------------------
// Division metadata
// ---------------------------------------------------------------------------

const DIVISION_TYPES = new Set([
  'chapter', 'section', 'subsection', 'subsubsection', 'paragraphs',
  // appendix is division-like at the same level as chapter
  'appendix',
]);

const DIV_DEPTH: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraphs: 5,
  appendix: 1,
};

/**
 * Structural container types whose content should be recursed into
 * without emitting a heading.  This handles full ptxast trees that
 * include a `pretext > book > chapter` hierarchy.
 */
const TRANSPARENT_TYPES = new Set([
  'pretext', 'book', 'article', 'frontmatter', 'backmatter', 'part',
]);

// ---------------------------------------------------------------------------
// Directive type metadata  (mirrors directive-map.ts in remark-pretext)
// ---------------------------------------------------------------------------

type DirectiveCategory =
  | 'theorem-like'    // has <statement> wrapper + optional proof children
  | 'definition-like' // has <statement> wrapper
  | 'remark-like'     // no statement wrapper, direct block children
  | 'example-like'    // no statement wrapper
  | 'proof-like'      // no statement wrapper
  | 'solution-like';  // no statement wrapper

interface DirectiveMeta {
  name: string;
  category: DirectiveCategory;
}

const TYPE_TO_DIRECTIVE = new Map<string, DirectiveMeta>([
  // theorem-like
  ['theorem',       { name: 'theorem',       category: 'theorem-like' }],
  ['lemma',         { name: 'lemma',         category: 'theorem-like' }],
  ['corollary',     { name: 'corollary',     category: 'theorem-like' }],
  ['proposition',   { name: 'proposition',   category: 'theorem-like' }],
  ['claim',         { name: 'claim',         category: 'theorem-like' }],
  ['fact',          { name: 'fact',          category: 'theorem-like' }],
  ['conjecture',    { name: 'conjecture',    category: 'theorem-like' }],
  ['axiom',         { name: 'axiom',         category: 'theorem-like' }],
  ['principle',     { name: 'principle',     category: 'theorem-like' }],
  ['hypothesis',    { name: 'hypothesis',    category: 'theorem-like' }],
  ['algorithm',     { name: 'algorithm',     category: 'theorem-like' }],
  // definition-like
  ['definition',    { name: 'definition',    category: 'definition-like' }],
  ['notation',      { name: 'notation',      category: 'definition-like' }],
  // remark-like
  ['remark',        { name: 'remark',        category: 'remark-like' }],
  ['note',          { name: 'note',          category: 'remark-like' }],
  ['observation',   { name: 'observation',   category: 'remark-like' }],
  ['warning',       { name: 'warning',       category: 'remark-like' }],
  ['insight',       { name: 'insight',       category: 'remark-like' }],
  ['assemblage',    { name: 'assemblage',    category: 'remark-like' }],
  // example-like
  ['example',       { name: 'example',       category: 'example-like' }],
  ['question',      { name: 'question',      category: 'example-like' }],
  ['problem',       { name: 'problem',       category: 'example-like' }],
  ['exercise',      { name: 'exercise',      category: 'example-like' }],
  ['activity',      { name: 'activity',      category: 'example-like' }],
  ['exploration',   { name: 'exploration',   category: 'example-like' }],
  ['investigation', { name: 'investigation', category: 'example-like' }],
  ['project',       { name: 'project',       category: 'example-like' }],
  // proof-like
  ['proof',         { name: 'proof',         category: 'proof-like' }],
  ['case',          { name: 'case',          category: 'proof-like' }],
  // solution-like
  ['solution',      { name: 'solution',      category: 'solution-like' }],
  ['hint',          { name: 'hint',          category: 'solution-like' }],
  ['answer',        { name: 'answer',        category: 'solution-like' }],
]);

// theorem-like and definition-like wrap body in <statement>
const HAS_STATEMENT_WRAPPER = new Set(['theorem-like', 'definition-like']);

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Convert an xast Root (PreTeXt document) to an mdast Root. */
export function ptxastToMdast(root: Root): MdastRoot {
  return {
    type: 'root',
    children: flattenChildren(root.children, 2),
  };
}

// ---------------------------------------------------------------------------
// Flattening divisions into heading + flat content
// ---------------------------------------------------------------------------

/**
 * Convert an array of xast ElementContent nodes to mdast, using `baseDepth`
 * for any divisions encountered at this level.
 */
function flattenChildren(nodes: ElementContent[], baseDepth: number): MdastContent[] {
  const result: MdastContent[] = [];
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    const el = node as Element;
    if (TRANSPARENT_TYPES.has(el.name)) {
      result.push(...flattenChildren(el.children, baseDepth));
    } else if (DIVISION_TYPES.has(el.name)) {
      const depth = (DIV_DEPTH[el.name] ?? baseDepth) as 1 | 2 | 3 | 4 | 5 | 6;
      result.push(...flattenDivision(el, depth));
    } else {
      const converted = convertBlock(el);
      if (converted !== null) result.push(converted);
    }
  }
  return result;
}

function flattenDivision(
  el: Element,
  depth: 1 | 2 | 3 | 4 | 5 | 6,
): MdastContent[] {
  const result: MdastContent[] = [];
  const attrs = el.attributes ?? {};
  const children = el.children;

  const titleNode = children.find(
    (c) => c.type === 'element' && (c as Element).name === 'title',
  ) as Element | undefined;
  const restChildren = children.filter(
    (c) => !(c.type === 'element' && (c as Element).name === 'title'),
  );

  const heading: Heading = {
    type: 'heading',
    depth,
    children: titleNode ? titleNode.children.map(convertInlineNode).filter(notNull) : [],
    ...(attrs['xml:id']
      ? { data: { id: attrs['xml:id'], hProperties: { id: attrs['xml:id'] } } }
      : {}),
  };
  result.push(heading);

  const childDepth = Math.min(depth + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6;
  result.push(...flattenChildren(restChildren, childDepth));

  return result;
}

// ---------------------------------------------------------------------------
// Block converters
// ---------------------------------------------------------------------------

function convertBlock(el: Element): BlockContent | DefinitionContent | null {
  switch (el.name) {
    case 'p':          return convertP(el);
    case 'blockquote': return convertBlockquote(el);
    case 'ol':         return convertList(el, true);
    case 'ul':         return convertList(el, false);
    case 'program':    return convertProgram(el);
    case 'me':
    case 'men':
    case 'md':
    case 'mdn':        return convertDisplayMath(el);
    default: {
      const directive = TYPE_TO_DIRECTIVE.get(el.name);
      if (directive) return convertDirective(el, directive);
      return null;
    }
  }
}

// ── Paragraph ───────────────────────────────────────────────────────────────

function convertP(el: Element): Paragraph {
  return {
    type: 'paragraph',
    children: el.children.map(convertInlineNode).filter(notNull),
  };
}

// ── Blockquote ───────────────────────────────────────────────────────────────

function convertBlockquote(el: Element): MdastBlockquote {
  return {
    type: 'blockquote',
    children: el.children
      .filter((c) => c.type === 'element')
      .map((c) => convertBlock(c as Element))
      .filter(notNull) as BlockContent[],
  };
}

// ── Lists ─────────────────────────────────────────────────────────────────────

function convertList(el: Element, ordered: boolean): List {
  return {
    type: 'list',
    ordered,
    spread: false,
    children: el.children
      .filter((c) => c.type === 'element')
      .map((c) => convertListItem(c as Element)),
  };
}

function convertListItem(el: Element): ListItem {
  return {
    type: 'listItem',
    spread: false,
    children: el.children
      .filter((c) => c.type === 'element')
      .map((c) => convertBlock(c as Element))
      .filter(notNull) as BlockContent[],
  };
}

// ── Code / program ───────────────────────────────────────────────────────────

function convertProgram(el: Element): Code {
  const attrs = el.attributes ?? {};
  return {
    type: 'code',
    lang: attrs['language'] ?? null,
    value: getPtxTextContent(el),
  };
}

// ── Display math ─────────────────────────────────────────────────────────────

function convertDisplayMath(el: Element): MdastMath {
  const children = el.children;
  // Single-line: first child is a Text node
  if (children.length > 0 && children[0].type === 'text') {
    return { type: 'math', value: (children[0] as { value: string }).value ?? '' };
  }
  // Multi-line: mrow elements
  const value = children
    .filter((child) => child.type === 'element' && (child as Element).name === 'mrow')
    .map((child) => getPtxTextContent(child as Element))
    .join(' \\\\\n');
  return { type: 'math', value };
}

// ---------------------------------------------------------------------------
// Directive (theorem/proof/definition/etc.) converters
// ---------------------------------------------------------------------------

function convertDirective(
  el: Element,
  meta: DirectiveMeta,
): ContainerDirective {
  const attrs = el.attributes ?? {};
  const children = el.children;

  const directiveAttrs: Record<string, string> = {};
  if (attrs['xml:id']) directiveAttrs['id'] = attrs['xml:id'];
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'xml:id' || v == null) continue;
    directiveAttrs[k] = v;
  }

  const titleNode = children.find(
    (c) => c.type === 'element' && (c as Element).name === 'title',
  ) as Element | undefined;

  const directiveChildren: (BlockContent | DefinitionContent)[] = [];

  if (titleNode) {
    const labelPara: Paragraph & { data: { directiveLabel: boolean } } = {
      type: 'paragraph',
      data: { directiveLabel: true },
      children: titleNode.children.map(convertInlineNode).filter(notNull),
    };
    directiveChildren.push(labelPara);
  }

  if (HAS_STATEMENT_WRAPPER.has(meta.category)) {
    for (const child of children) {
      if (child.type !== 'element') continue;
      const childEl = child as Element;
      if (childEl.name === 'title') continue;
      if (childEl.name === 'statement') {
        for (const sc of childEl.children) {
          if (sc.type !== 'element') continue;
          const c = convertBlock(sc as Element);
          if (c) directiveChildren.push(c);
        }
      } else {
        const c = convertBlock(childEl);
        if (c) directiveChildren.push(c);
      }
    }
  } else {
    for (const child of children) {
      if (child.type !== 'element') continue;
      const childEl = child as Element;
      if (childEl.name === 'title') continue;
      const c = convertBlock(childEl);
      if (c) directiveChildren.push(c);
    }
  }

  return {
    type: 'containerDirective',
    name: meta.name,
    attributes: Object.keys(directiveAttrs).length > 0 ? directiveAttrs : undefined,
    children: directiveChildren,
  } as unknown as ContainerDirective;
}

// ---------------------------------------------------------------------------
// Inline converters
// ---------------------------------------------------------------------------

function convertInlineNode(node: ElementContent): PhrasingContent | null {
  if (node.type === 'text') {
    return { type: 'text', value: (node as { value: string }).value ?? '' } as Text;
  }
  if (node.type !== 'element') return null;
  const el = node as Element;
  switch (el.name) {
    case 'em':
      return {
        type: 'emphasis',
        children: el.children.map(convertInlineNode).filter(notNull),
      } as Emphasis;
    case 'alert':
      return {
        type: 'strong',
        children: el.children.map(convertInlineNode).filter(notNull),
      } as Strong;
    case 'c':
      return { type: 'inlineCode', value: getPtxTextContent(el) } as InlineCode;
    case 'm':
      return { type: 'inlineMath', value: getPtxTextContent(el) } as InlineMath;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function notNull<T>(value: T | null): value is T {
  return value !== null;
}
