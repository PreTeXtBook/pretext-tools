/**
 * mdast-to-xast: transforms an mdast Root into an xast Root containing
 * PreTeXt element nodes.
 *
 * Architecture (Phase 1 refactor):
 * - Uses handler dictionaries (blockHandlers, inlineHandlers) for extensibility
 * - Passes VisitContext through the pipeline for handler awareness
 * - Collects conversion messages (warnings/errors) for diagnostics
 *
 * Handles:
 *   - Headings  chapter/section/subsection/subsubsection/paragraphs elements
 *     (via recursive section nesting)
 *   - Paragraphs  p elements
 *   - Blockquotes  blockquote elements
 *   - Lists  ol/ul elements with li children
 *   - Fenced code  program elements
 *   - Display math (custom parser or mdast `math` nodes)  md elements
 *   - Container directives (remark-directive)  theorem/proof/example/... elements
 *   - Inline: text, emphasis, strong, inlineCode, custom `math` nodes
 */

import type {
  Root as MdastRoot,
  Content,
  BlockContent,
  DefinitionContent,
  PhrasingContent,
  Paragraph,
  Heading,
  Text,
  Strong,
  Emphasis,
  InlineCode,
  List,
  ListItem,
  Blockquote as MdastBlockquote,
  Code,
} from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import type { Math as CustomMath } from './math-parser.js';
import type { Root } from 'xast';
import type { Element } from 'xast';
import { DIRECTIVE_MAP, PROOF_SOLUTION_NAMES } from './directive-map.js';
import type { VisitContext, ConversionMessage } from './context.js';

// ---------------------------------------------------------------------------
// Xast node builders (local helpers for this module)
// ---------------------------------------------------------------------------

type XastText = { type: 'text'; value: string };
type XastChild = Element | XastText;

function text(value: string): XastText {
  return { type: 'text', value };
}

function el(
  name: string,
  children: XastChild[],
  attributes?: Record<string, string>,
): Element {
  return {
    type: 'element',
    name,
    attributes: attributes ?? {},
    children: children as Element['children'],
  };
}

/** Create a value element: single text child holds the raw string content. */
function valueEl(name: string, value: string, attributes?: Record<string, string>): Element {
  return el(name, [text(value)], attributes);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Result type for conversion: tree + diagnostic messages. */
export interface ConversionResult {
  tree: Root;
  messages: ConversionMessage[];
}

/** Transform an mdast Root node into an xast Root node (backwards compatible). */
export function mdastToPtxast(tree: MdastRoot): Root {
  const result = mdastToPtxastWithDiagnostics(tree);
  return result.tree;
}

// keep legacy export name for backwards compatibility
export { mdastToPtxast as mdastToXast };

/** Transform an mdast Root node, returning tree + diagnostic messages. */
export function mdastToPtxastWithDiagnostics(tree: MdastRoot): ConversionResult {
  const messages: ConversionMessage[] = [];
  const ctx: VisitContext = { ancestors: [], depth: 0, messages };
  const nodes = tree.children as Array<BlockContent | DefinitionContent>;
  const children = nestSections(nodes, ctx);
  return {
    tree: { type: 'root', children: children as Root['children'] },
    messages,
  };
}

// ---------------------------------------------------------------------------
// Section nesting
// ---------------------------------------------------------------------------

type DivType = 'chapter' | 'section' | 'subsection' | 'subsubsection' | 'paragraphs';

const DEPTH_TO_TYPE: DivType[] = ['chapter', 'section', 'subsection', 'subsubsection', 'paragraphs'];

function depthToType(depth: number): DivType {
  return DEPTH_TO_TYPE[Math.min(depth - 1, DEPTH_TO_TYPE.length - 1)];
}

/**
 * Partition a flat list of mdast nodes by headings at the minimum heading depth
 * present, recursively nesting deeper headings inside each section.
 */
function nestSections(
  nodes: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext
): Element[] {
  let minDepth = 7;
  for (const node of nodes) {
    if (node.type === 'heading') minDepth = Math.min(minDepth, (node as Heading).depth);
  }
  if (minDepth === 7) {
    return convertBlockSequence(nodes, ctx);
  }

  const result: Element[] = [];
  let currentHeading: Heading | null = null;
  let preHeadingNodes: Array<BlockContent | DefinitionContent> = [];
  let currentBody: Array<BlockContent | DefinitionContent> = [];

  const flushSection = () => {
    if (!currentHeading) return;
    result.push(buildDivision(currentHeading, currentBody, ctx));
    currentHeading = null;
    currentBody = [];
  };

  for (const node of nodes) {
    if (node.type === 'heading' && (node as Heading).depth === minDepth) {
      if (!currentHeading && preHeadingNodes.length > 0) {
        result.push(...convertBlockSequence(preHeadingNodes, ctx));
        preHeadingNodes = [];
      }
      flushSection();
      currentHeading = node as Heading;
      currentBody = [];
    } else if (currentHeading) {
      currentBody.push(node);
    } else {
      preHeadingNodes.push(node);
    }
  }
  if (!currentHeading && preHeadingNodes.length > 0) {
    result.push(...convertBlockSequence(preHeadingNodes, ctx));
  }
  flushSection();
  return result;
}

function convertBlockSequence(
  nodes: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext
): Element[] {
  const result: Element[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    // Pass the same parent context; only extend ancestors with this node
    const childCtx = { ...ctx, ancestors: [...ctx.ancestors, node], depth: ctx.depth + 1 };

    const converted = convertBlock(node, childCtx);
    if (converted === null) continue;

    // Fold display-math-only paragraphs into paragraph flow.
    if (
      converted.name === 'p' &&
      converted.children.length === 1 &&
      (converted.children[0] as Element).name === 'md'
    ) {
      const md = converted.children[0] as Element;
      const prev = result[result.length - 1];
      const nextConverted = i + 1 < nodes.length ? convertBlock(nodes[i + 1], childCtx) : null;
      const nextParagraphChildren = nextConverted?.name === 'p' ? nextConverted.children : null;

      if (prev?.name === 'p') {
        (prev.children as XastChild[]).push(md);
        if (nextParagraphChildren) {
          (prev.children as XastChild[]).push(...(nextParagraphChildren as XastChild[]));
          i += 1;
        }
      } else {
        const children: XastChild[] = [md];
        if (nextParagraphChildren) {
          children.push(...(nextParagraphChildren as XastChild[]));
          i += 1;
        }
        result.push(el('p', children));
      }

      continue;
    }

    result.push(converted);
  }

  return result;
}

function buildDivision(
  heading: Heading,
  body: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext
): Element {
  const divType = depthToType(heading.depth);
  const titleEl = el('title', convertInlineNodes(heading.children, ctx));
  const attrs = getHeadingAttrs(heading);
  const innerChildren = nestSections(body, { ...ctx, depth: ctx.depth + 1 });

  return el(divType, [titleEl, ...innerChildren], attrs);
}

function getHeadingAttrs(heading: Heading): Record<string, string> | undefined {
  const data = heading.data as { id?: string } | undefined;
  return data?.id ? { 'xml:id': data.id } : undefined;
}

// ---------------------------------------------------------------------------
// Block converters (using handler dictionary pattern)
// ---------------------------------------------------------------------------

/** Dictionary of block handlers. Maps node type → handler function. */
const blockHandlers: Record<
  string,
  (node: BlockContent | DefinitionContent, ctx: VisitContext) => Element | null
> = {
  paragraph: (node, ctx) => convertParagraph(node as Paragraph, ctx),
  blockquote: (node, ctx) => convertBlockquote(node as MdastBlockquote, ctx),
  list: (node, ctx) => convertList(node as List, ctx),
  code: (node, ctx) => convertCode(node as Code, ctx),
  containerDirective: (node, ctx) => convertContainerDirective(node as ContainerDirective, ctx),
};

function convertBlock(node: BlockContent | DefinitionContent, ctx: VisitContext): Element | null {
  const handler = blockHandlers[node.type];

  if (!handler) {
    if (ctx.messages) {
      ctx.messages.push({
        type: 'warning',
        reason: `Unknown block type: ${node.type}`,
        category: 'unknown-block-type',
      });
    }
    return null;
  }

  return handler(node, ctx);
}

function convertParagraph(node: Paragraph, ctx: VisitContext): Element {
  return el('p', convertInlineNodes(node.children, ctx));
}

function convertBlockquote(node: MdastBlockquote, ctx: VisitContext): Element {
  const paragraphs = (node.children as Array<BlockContent | DefinitionContent>)
    .filter((n): n is Paragraph => n.type === 'paragraph')
    .map(n => {
      // Pass blockquote as parent context for its paragraph children
      const childCtx = { ...ctx, ancestors: [...ctx.ancestors, node], depth: ctx.depth + 1 };
      return convertParagraph(n, childCtx);
    });
  return el('blockquote', paragraphs);
}

function convertList(node: List, ctx: VisitContext): Element {
  const items = node.children.map(child => {
    const childCtx = { ...ctx, ancestors: [...ctx.ancestors, node], depth: ctx.depth + 1 };
    return convertListItem(child, childCtx);
  });
  return el(node.ordered ? 'ol' : 'ul', items);
}

function convertListItem(node: ListItem, ctx: VisitContext): Element {
  const children = convertBlockSequence(node.children as Array<BlockContent | DefinitionContent>, ctx);
  return el('li', children);
}

function convertCode(node: Code, ctx: VisitContext): Element {
  return valueEl('program', node.value, node.lang ? { language: node.lang } : undefined);
}

function convertDisplayMath(node: CustomMath, ctx: VisitContext): Element {
  const rows = node.value
    .split(/\\\\|[\r\n]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (rows.length > 1) {
    return el('md', rows.map(line => valueEl('mrow', line)));
  }
  return valueEl('md', rows[0] ?? '');
}

function convertMathNode(node: CustomMath, ctx: VisitContext): Element | null {
  if (node.meta === 'inline') {
    return valueEl('m', node.value);
  }
  return convertDisplayMath(node, ctx);
}

// ---------------------------------------------------------------------------
// Container directive converters
// ---------------------------------------------------------------------------

function convertContainerDirective(node: ContainerDirective, ctx: VisitContext): Element | null {
  const info = DIRECTIVE_MAP[node.name];

  if (!info) {
    if (ctx.messages) {
      ctx.messages.push({
        type: 'warning',
        reason: `Unknown directive: ${node.name}`,
        category: 'unknown-directive',
      });
    }
    return null;
  }

  const attrs = buildDirectiveAttrs(node);
  const directiveChildren = node.children as Array<BlockContent | DefinitionContent>;
  const { title: titleEl, body } = extractDirectiveLabel(directiveChildren, ctx);

  const childCtx = { ...ctx, ancestors: [...ctx.ancestors, node], depth: ctx.depth + 1 };

  switch (info.category) {
    case 'theorem-like':
    case 'definition-like':
      return buildTheoremLike(info.type, attrs, titleEl, body, childCtx);
    case 'remark-like':
    case 'proof-like':
    case 'solution-like':
      return buildContentBlock(info.type, attrs, titleEl, body, childCtx);
    case 'example-like':
      return buildExampleLike(info.type, attrs, titleEl, body, childCtx);
  }
}

function extractDirectiveLabel(
  children: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext,
): {
  title: Element | null;
  body: Array<BlockContent | DefinitionContent>;
} {
  const first = children[0];
  if (
    first?.type === 'paragraph' &&
    (first as Paragraph & { data?: { directiveLabel?: boolean } }).data?.directiveLabel === true
  ) {
    return {
      title: el('title', convertInlineNodes((first as Paragraph).children, ctx)),
      body: children.slice(1),
    };
  }
  return { title: null, body: children };
}

function buildDirectiveAttrs(node: ContainerDirective): Record<string, string> | undefined {
  const raw = node.attributes ?? {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    result[k === 'id' ? 'xml:id' : k] = v;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildTheoremLike(
  type: string,
  attrs: Record<string, string> | undefined,
  titleEl: Element | null,
  children: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext
): Element {
  const bodyNodes: Array<BlockContent | DefinitionContent> = [];
  const proofNodes: ContainerDirective[] = [];

  for (const child of children) {
    if (
      child.type === 'containerDirective' &&
      PROOF_SOLUTION_NAMES.has((child as ContainerDirective).name)
    ) {
      proofNodes.push(child as ContainerDirective);
    } else {
      bodyNodes.push(child);
    }
  }

  const statementChildren = convertBlockSequence(bodyNodes, ctx);

  const result: Element[] = [];
  if (titleEl) result.push(titleEl);
  if (statementChildren.length > 0) {
    result.push(el('statement', statementChildren));
  }
  for (const pd of proofNodes) {
    const converted = convertContainerDirective(pd, ctx);
    if (converted) result.push(converted);
  }

  return el(type, result, attrs);
}

function buildContentBlock(
  type: string,
  attrs: Record<string, string> | undefined,
  titleEl: Element | null,
  children: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext
): Element {
  const converted: Element[] = [];
  if (titleEl) converted.push(titleEl);
  converted.push(...convertBlockSequence(children, ctx));
  return el(type, converted, attrs);
}

function buildExampleLike(
  type: string,
  attrs: Record<string, string> | undefined,
  titleEl: Element | null,
  children: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext
): Element {
  return buildContentBlock(type, attrs, titleEl, children, ctx);
}

// ---------------------------------------------------------------------------
// Inline converters (using handler dictionary pattern)
// ---------------------------------------------------------------------------

/** Dictionary of inline handlers. Maps node type → handler function. */
const inlineHandlers: Record<
  string,
  (node: PhrasingContent, ctx: VisitContext) => XastChild | null
> = {
  text: (node, ctx) => text((node as Text).value),
  emphasis: (node, ctx) => el('em', convertInlineNodes((node as Emphasis).children, ctx)),
  strong: (node, ctx) => el('alert', convertInlineNodes((node as Strong).children, ctx)),
  inlineCode: (node, ctx) => valueEl('c', (node as InlineCode).value),
  math: (node, ctx) => convertMathNode(node as unknown as CustomMath, ctx),
};

function convertInlineNodes(nodes: PhrasingContent[], ctx: VisitContext): XastChild[] {
  return nodes.flatMap(node => convertInline(node, ctx)).filter((n): n is XastChild => n !== null);
}

function convertInline(node: PhrasingContent, ctx: VisitContext): XastChild | null {
  const handler = inlineHandlers[node.type];

  if (!handler) {
    if (ctx.messages) {
      ctx.messages.push({
        type: 'warning',
        reason: `Unknown inline type: ${node.type}`,
        category: 'unknown-inline-type',
      });
    }
    return null;
  }

  // Pass context with this node added to ancestors, but parent unchanged
  const childCtx = { ...ctx, ancestors: [...ctx.ancestors, node] };
  return handler(node, childCtx);
}
