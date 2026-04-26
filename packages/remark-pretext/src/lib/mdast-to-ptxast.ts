/**
 * mdast-to-ptxast: transforms an mdast Root into a ptxast PtxRoot.
 *
 * Handles:
 *   - Headings → chapter/section/subsection/subsubsection/paragraphs nodes
 *     (via recursive section nesting)
 *   - Paragraphs → p nodes
 *   - Blockquotes → blockquote nodes
 *   - Lists → ol/ul nodes with li children
 *   - Fenced code → program nodes
 *   - Display math (remark-math `math` nodes) → me nodes
 *   - Container directives (remark-directive) → theorem/proof/example/... nodes
 *   - Inline: text, emphasis, strong, inlineCode, inlineMath
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
import type { Math as MdastMath, InlineMath } from 'mdast-util-math';
import type {
  PtxRoot,
  PtxContent,
  PtxBlockContent,
  PtxInlineContent,
  Chapter,
  Section,
  Subsection,
  Subsubsection,
  Paragraphs,
  Title,
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
  Blockquote,
  Program,
  Statement,
} from '@pretextbook/ptxast';
import { DIRECTIVE_MAP, PROOF_SOLUTION_NAMES } from './directive-map.js';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Transform an mdast Root node into a ptxast PtxRoot node. */
export function mdastToPtxast(tree: MdastRoot): PtxRoot {
  const nodes = tree.children as Array<BlockContent | DefinitionContent>;
  const children = nestSections(nodes);
  return { type: 'root', children };
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
function nestSections(nodes: Array<BlockContent | DefinitionContent>): PtxContent[] {
  // Find the minimum heading depth present in the current nodes
  let minDepth = 7;
  for (const node of nodes) {
    if (node.type === 'heading') minDepth = Math.min(minDepth, (node as Heading).depth);
  }
  // No headings — convert all blocks directly
  if (minDepth === 7) {
    return nodes.map(convertBlock).filter((n): n is PtxBlockContent => n !== null);
  }

  const result: PtxContent[] = [];
  let currentHeading: Heading | null = null;
  let currentBody: Array<BlockContent | DefinitionContent> = [];

  const flushSection = () => {
    if (!currentHeading) return;
    result.push(buildDivision(currentHeading, currentBody));
    currentHeading = null;
    currentBody = [];
  };

  for (const node of nodes) {
    if (node.type === 'heading' && (node as Heading).depth === minDepth) {
      flushSection();
      currentHeading = node as Heading;
      currentBody = [];
    } else if (currentHeading) {
      currentBody.push(node);
    } else {
      // Content before any heading — emit as-is
      const converted = convertBlock(node);
      if (converted !== null) result.push(converted);
    }
  }
  flushSection();
  return result;
}

function buildDivision(
  heading: Heading,
  body: Array<BlockContent | DefinitionContent>
): PtxContent {
  const divType = depthToType(heading.depth);
  const titleNode: Title = { type: 'title', children: convertInlineNodes(heading.children) };
  const attrs = getHeadingAttrs(heading);
  const innerChildren = nestSections(body);

  const base = {
    ...(attrs ? { attributes: attrs } : {}),
    children: [titleNode, ...innerChildren],
  };

  switch (divType) {
    case 'chapter':       return { type: 'chapter',       ...base } as Chapter;
    case 'section':       return { type: 'section',       ...base } as Section;
    case 'subsection':    return { type: 'subsection',    ...base } as Subsection;
    case 'subsubsection': return { type: 'subsubsection', ...base } as Subsubsection;
    default:              return { type: 'paragraphs',    ...base } as Paragraphs;
  }
}

function getHeadingAttrs(heading: Heading): Record<string, string> | undefined {
  const data = heading.data as { id?: string } | undefined;
  return data?.id ? { 'xml:id': data.id } : undefined;
}

// ---------------------------------------------------------------------------
// Block converters
// ---------------------------------------------------------------------------

function convertBlock(node: BlockContent | DefinitionContent): PtxBlockContent | null {
  switch (node.type) {
    case 'paragraph':          return convertParagraph(node as Paragraph);
    case 'blockquote':         return convertBlockquote(node as MdastBlockquote);
    case 'list':               return convertList(node as List);
    case 'code':               return convertCode(node as Code);
    case 'math':               return convertDisplayMath(node as MdastMath);
    case 'containerDirective': return convertContainerDirective(node as ContainerDirective);
    default:                   return null;
  }
}

function convertParagraph(node: Paragraph): P {
  return { type: 'p', children: convertInlineNodes(node.children) };
}

function convertBlockquote(node: MdastBlockquote): Blockquote {
  const paragraphs = (node.children as Array<BlockContent | DefinitionContent>)
    .filter((n): n is Paragraph => n.type === 'paragraph')
    .map(convertParagraph);
  return { type: 'blockquote', children: paragraphs };
}

function convertList(node: List): Ol | Ul {
  const items = node.children.map(convertListItem);
  return node.ordered
    ? { type: 'ol', children: items }
    : { type: 'ul', children: items };
}

function convertListItem(node: ListItem): Li {
  const children = (node.children as Array<BlockContent | DefinitionContent>)
    .map(convertBlock)
    .filter((n): n is PtxBlockContent => n !== null);
  return { type: 'li', children };
}

function convertCode(node: Code): Program {
  return {
    type: 'program',
    value: node.value,
    ...(node.lang ? { attributes: { language: node.lang } } : {}),
  };
}

function convertDisplayMath(node: MdastMath): Me {
  return { type: 'me', value: node.value };
}

// ---------------------------------------------------------------------------
// Container directive converters
// ---------------------------------------------------------------------------

function convertContainerDirective(node: ContainerDirective): PtxBlockContent | null {
  const info = DIRECTIVE_MAP[node.name];
  if (!info) return null;

  const attrs = buildDirectiveAttrs(node);
  const directiveChildren = node.children as Array<BlockContent | DefinitionContent>;
  const { title, body } = extractDirectiveLabel(directiveChildren);

  switch (info.category) {
    case 'theorem-like':
    case 'definition-like':
      return buildTheoremLike(info.type, attrs, title, body);
    case 'remark-like':
    case 'proof-like':
    case 'solution-like':
      return buildContentBlock(info.type, attrs, title, body);
    case 'example-like':
      return buildExampleLike(info.type, attrs, title, body);
  }
}

/**
 * Extract the directive label from children.
 * The label paragraph has `data.directiveLabel === true` and is always first.
 */
function extractDirectiveLabel(children: Array<BlockContent | DefinitionContent>): {
  title: Title | null;
  body: Array<BlockContent | DefinitionContent>;
} {
  const first = children[0];
  if (
    first?.type === 'paragraph' &&
    (first as Paragraph & { data?: { directiveLabel?: boolean } }).data?.directiveLabel === true
  ) {
    return {
      title: { type: 'title', children: convertInlineNodes((first as Paragraph).children) },
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

/**
 * Build a theorem-like / definition-like node:
 * - Separate proof/solution-like children from the main body
 * - Wrap main body in a `<statement>` node
 * - Append proof/solution-like nodes after the statement
 */
function buildTheoremLike(
  type: string,
  attrs: Record<string, string> | undefined,
  title: Title | null,
  children: Array<BlockContent | DefinitionContent>
): PtxBlockContent {
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

  const statementChildren = bodyNodes
    .map(convertBlock)
    .filter((n): n is PtxBlockContent => n !== null);

  const result: PtxContent[] = [];
  if (title) result.push(title);
  if (statementChildren.length > 0) {
    result.push({ type: 'statement', children: statementChildren } as Statement);
  }
  for (const pd of proofNodes) {
    const converted = convertContainerDirective(pd);
    if (converted) result.push(converted);
  }

  return { type, ...(attrs ? { attributes: attrs } : {}), children: result } as unknown as PtxBlockContent;
}

/**
 * Build a remark-like, proof-like, or solution-like node:
 * title + direct block children (no statement wrapper).
 */
function buildContentBlock(
  type: string,
  attrs: Record<string, string> | undefined,
  title: Title | null,
  children: Array<BlockContent | DefinitionContent>
): PtxBlockContent {
  const converted: PtxContent[] = [];
  if (title) converted.push(title);
  for (const child of children) {
    const c = convertBlock(child);
    if (c) converted.push(c);
  }
  return { type, ...(attrs ? { attributes: attrs } : {}), children: converted } as unknown as PtxBlockContent;
}

/**
 * Build an example-like node: title + direct block content.
 * (Same structure as remark-like; kept separate for future specialization.)
 */
function buildExampleLike(
  type: string,
  attrs: Record<string, string> | undefined,
  title: Title | null,
  children: Array<BlockContent | DefinitionContent>
): PtxBlockContent {
  return buildContentBlock(type, attrs, title, children);
}

// ---------------------------------------------------------------------------
// Inline converters
// ---------------------------------------------------------------------------

function convertInlineNodes(nodes: PhrasingContent[]): PtxInlineContent[] {
  return nodes.flatMap(convertInline).filter((n): n is PtxInlineContent => n !== null);
}

function convertInline(node: PhrasingContent): PtxInlineContent | null {
  switch (node.type) {
    case 'text':       return { type: 'text',  value: (node as Text).value } as PtxText;
    case 'emphasis':   return { type: 'em',    children: convertInlineNodes((node as Emphasis).children) } as Em;
    case 'strong':     return { type: 'alert', children: convertInlineNodes((node as Strong).children) } as Alert;
    case 'inlineCode': return { type: 'c',     value: (node as InlineCode).value } as C;
    case 'inlineMath': return { type: 'm',     value: (node as InlineMath).value } as M;
    default:           return null;
  }
}
