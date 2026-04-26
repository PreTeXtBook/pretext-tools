/**
 * ptxast-to-mdast: converts a ptxast PtxRoot into an mdast Root.
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
import type {
  PtxRoot,
  PtxContent,
  Title,
} from '@pretextbook/ptxast';

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

/** Convert a ptxast PtxRoot to an mdast Root. */
export function ptxastToMdast(root: PtxRoot): MdastRoot {
  return {
    type: 'root',
    children: flattenChildren(root.children, 2),
  };
}

// ---------------------------------------------------------------------------
// Flattening divisions into heading + flat content
// ---------------------------------------------------------------------------

/**
 * Convert an array of ptxast nodes to mdast, using `baseDepth` for any
 * divisions encountered at this level.  Divisions are flattened: a section
 * at depth 2 emits a `## heading` followed by its own children.
 */
function flattenChildren(nodes: PtxContent[], baseDepth: number): MdastContent[] {
  const result: MdastContent[] = [];
  for (const node of nodes) {
    if (TRANSPARENT_TYPES.has(node.type)) {
      // Recurse into structural containers (pretext/book/article/etc.) without a heading
      const obj = node as unknown as Record<string, unknown>;
      const children = (obj['children'] as PtxContent[]) ?? [];
      result.push(...flattenChildren(children, baseDepth));
    } else if (DIVISION_TYPES.has(node.type)) {
      const depth = (DIV_DEPTH[node.type] ?? baseDepth) as 1 | 2 | 3 | 4 | 5 | 6;
      result.push(...flattenDivision(node, depth));
    } else {
      const converted = convertBlock(node);
      if (converted !== null) result.push(converted);
    }
  }
  return result;
}

function flattenDivision(
  node: PtxContent,
  depth: 1 | 2 | 3 | 4 | 5 | 6,
): MdastContent[] {
  const result: MdastContent[] = [];
  const obj = node as unknown as Record<string, unknown>;
  const attrs = obj['attributes'] as Record<string, string | undefined> | undefined;
  const children = (obj['children'] as PtxContent[]) ?? [];

  // Extract title child
  const titleNode = children.find((c) => c.type === 'title') as Title | undefined;
  const restChildren = children.filter((c) => c.type !== 'title');

  const heading: Heading = {
    type: 'heading',
    depth,
    children: titleNode ? titleNode.children.map(convertInlineNode).filter(notNull) : [],
    ...(attrs?.['xml:id']
      ? { data: { id: attrs['xml:id'], hProperties: { id: attrs['xml:id'] } } }
      : {}),
  };
  result.push(heading);

  // Recurse: deeper divisions get depth + 1 (capped at 6)
  const childDepth = Math.min(depth + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6;
  result.push(...flattenChildren(restChildren, childDepth));

  return result;
}

// ---------------------------------------------------------------------------
// Block converters
// ---------------------------------------------------------------------------

function convertBlock(node: PtxContent): BlockContent | DefinitionContent | null {
  switch (node.type) {
    case 'p':          return convertP(node);
    case 'blockquote': return convertBlockquote(node);
    case 'ol':         return convertList(node, true);
    case 'ul':         return convertList(node, false);
    case 'program':    return convertProgram(node);
    case 'me':
    case 'men':        return convertDisplayMath(node);
    default: {
      const directive = TYPE_TO_DIRECTIVE.get(node.type);
      if (directive) return convertDirective(node, directive);
      return null;
    }
  }
}

// ── Paragraph ───────────────────────────────────────────────────────────────

function convertP(node: PtxContent): Paragraph {
  const obj = node as unknown as Record<string, unknown>;
  const children = (obj['children'] as PtxContent[]) ?? [];
  return {
    type: 'paragraph',
    children: children.map(convertInlineNode).filter(notNull),
  };
}

// ── Blockquote ───────────────────────────────────────────────────────────────

function convertBlockquote(node: PtxContent): MdastBlockquote {
  const obj = node as unknown as Record<string, unknown>;
  const children = (obj['children'] as PtxContent[]) ?? [];
  return {
    type: 'blockquote',
    children: children.map(convertBlock).filter(notNull) as BlockContent[],
  };
}

// ── Lists ─────────────────────────────────────────────────────────────────────

function convertList(node: PtxContent, ordered: boolean): List {
  const obj = node as unknown as Record<string, unknown>;
  const children = (obj['children'] as PtxContent[]) ?? [];
  return {
    type: 'list',
    ordered,
    spread: false,
    children: children.map(convertListItem),
  };
}

function convertListItem(node: PtxContent): ListItem {
  const obj = node as unknown as Record<string, unknown>;
  const children = (obj['children'] as PtxContent[]) ?? [];
  return {
    type: 'listItem',
    spread: false,
    children: children.map(convertBlock).filter(notNull) as BlockContent[],
  };
}

// ── Code / program ───────────────────────────────────────────────────────────

function convertProgram(node: PtxContent): Code {
  const obj = node as unknown as Record<string, unknown>;
  const attrs = obj['attributes'] as Record<string, string | undefined> | undefined;
  return {
    type: 'code',
    lang: attrs?.['language'] ?? null,
    value: (obj['value'] as string) ?? '',
  };
}

// ── Display math ─────────────────────────────────────────────────────────────

function convertDisplayMath(node: PtxContent): MdastMath {
  const obj = node as unknown as Record<string, unknown>;
  return {
    type: 'math',
    value: (obj['value'] as string) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Directive (theorem/proof/definition/etc.) converters
// ---------------------------------------------------------------------------

function convertDirective(
  node: PtxContent,
  meta: DirectiveMeta,
): ContainerDirective {
  const obj = node as unknown as Record<string, unknown>;
  const attrs = obj['attributes'] as Record<string, string | undefined> | undefined;
  const children = (obj['children'] as PtxContent[]) ?? [];

  // Build directive attributes (xml:id → id)
  const directiveAttrs: Record<string, string> = {};
  if (attrs?.['xml:id']) directiveAttrs['id'] = attrs['xml:id'];
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === 'xml:id' || v == null) continue;
    directiveAttrs[k] = v;
  }

  // Extract <title> child for the directive label
  const titleNode = children.find((c) => c.type === 'title') as
    | { type: 'title'; children: PtxContent[] }
    | undefined;

  // Build directive children list
  const directiveChildren: (BlockContent | DefinitionContent)[] = [];

  // Add label paragraph from title
  if (titleNode) {
    const labelPara: Paragraph & { data: { directiveLabel: boolean } } = {
      type: 'paragraph',
      data: { directiveLabel: true },
      children: titleNode.children.map(convertInlineNode).filter(notNull),
    };
    directiveChildren.push(labelPara);
  }

  if (HAS_STATEMENT_WRAPPER.has(meta.category)) {
    // theorem-like / definition-like: unwrap <statement>, then add proof children
    for (const child of children) {
      if (child.type === 'title') continue;
      if (child.type === 'statement') {
        const stmtObj = child as unknown as Record<string, unknown>;
        const stmtChildren = (stmtObj['children'] as PtxContent[]) ?? [];
        for (const sc of stmtChildren) {
          const c = convertBlock(sc);
          if (c) directiveChildren.push(c);
        }
      } else {
        // proof/solution nested directives after the statement
        const c = convertBlock(child);
        if (c) directiveChildren.push(c);
      }
    }
  } else {
    // remark-like / example-like / proof-like / solution-like: direct children
    for (const child of children) {
      if (child.type === 'title') continue;
      const c = convertBlock(child);
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

function convertInlineNode(node: PtxContent): PhrasingContent | null {
  switch (node.type) {
    case 'text': {
      const obj = node as unknown as Record<string, unknown>;
      return { type: 'text', value: (obj['value'] as string) ?? '' } as Text;
    }
    case 'em': {
      const obj = node as unknown as Record<string, unknown>;
      const children = (obj['children'] as PtxContent[]) ?? [];
      return {
        type: 'emphasis',
        children: children.map(convertInlineNode).filter(notNull),
      } as Emphasis;
    }
    case 'alert': {
      const obj = node as unknown as Record<string, unknown>;
      const children = (obj['children'] as PtxContent[]) ?? [];
      return {
        type: 'strong',
        children: children.map(convertInlineNode).filter(notNull),
      } as Strong;
    }
    case 'c': {
      const obj = node as unknown as Record<string, unknown>;
      return { type: 'inlineCode', value: (obj['value'] as string) ?? '' } as InlineCode;
    }
    case 'm': {
      const obj = node as unknown as Record<string, unknown>;
      return { type: 'inlineMath', value: (obj['value'] as string) ?? '' } as InlineMath;
    }
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
