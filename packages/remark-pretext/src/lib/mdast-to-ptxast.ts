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
 *   - Display math (custom parser or mdast `math` nodes) → md nodes
 *   - Container directives (remark-directive) → theorem/proof/example/... nodes
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
  Ol,
  Ul,
  Li,
  Blockquote,
  Program,
  Statement,
  Md,
  Mrow,
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
    return convertBlockSequence(nodes);
  }

  const result: PtxContent[] = [];
  let currentHeading: Heading | null = null;
  let preHeadingNodes: Array<BlockContent | DefinitionContent> = [];
  let currentBody: Array<BlockContent | DefinitionContent> = [];

  const flushSection = () => {
    if (!currentHeading) return;
    result.push(buildDivision(currentHeading, currentBody));
    currentHeading = null;
    currentBody = [];
  };

  for (const node of nodes) {
    if (node.type === 'heading' && (node as Heading).depth === minDepth) {
      if (!currentHeading && preHeadingNodes.length > 0) {
        result.push(...convertBlockSequence(preHeadingNodes));
        preHeadingNodes = [];
      }
      flushSection();
      currentHeading = node as Heading;
      currentBody = [];
    } else if (currentHeading) {
      currentBody.push(node);
    } else {
      // Content before any heading — keep sequence context for math/paragraph merging
      preHeadingNodes.push(node);
    }
  }
  if (!currentHeading && preHeadingNodes.length > 0) {
    result.push(...convertBlockSequence(preHeadingNodes));
  }
  flushSection();
  return result;
}

function convertBlockSequence(nodes: Array<BlockContent | DefinitionContent>): PtxBlockContent[] {
  const result: PtxBlockContent[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];

    const converted = convertBlock(node);
    if (converted === null) continue;

    // Fold display-math-only paragraphs into paragraph flow instead of creating
    // standalone paragraphs for display math blocks.
    if (
      converted.type === 'p'
      && converted.children.length === 1
      && converted.children[0].type === 'md'
    ) {
      const md = converted.children[0] as Md;
      const prev = result[result.length - 1];
      const nextConverted = i + 1 < nodes.length ? convertBlock(nodes[i + 1]) : null;
      const nextParagraphChildren = nextConverted?.type === 'p' ? nextConverted.children : null;

      if (prev?.type === 'p') {
        prev.children.push(md as unknown as PtxInlineContent);
        if (nextParagraphChildren) {
          prev.children.push(...nextParagraphChildren);
          i += 1;
        }
      } else {
        const children: PtxInlineContent[] = [md as unknown as PtxInlineContent];
        if (nextParagraphChildren) {
          children.push(...nextParagraphChildren);
          i += 1;
        }
        result.push({ type: 'p', children });
      }

      continue;
    }

    result.push(converted);
  }

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
  const children = convertBlockSequence(node.children as Array<BlockContent | DefinitionContent>);
  return { type: 'li', children };
}

function convertCode(node: Code): Program {
  return {
    type: 'program',
    value: node.value,
    ...(node.lang ? { attributes: { language: node.lang } } : {}),
  };
}

function convertDisplayMath(node: CustomMath): Md {
  // Split on both literal newlines (from markdown) and escaped backslashes (\\) from LaTeX
  const rows = node.value
    .split(/\\\\|[\r\n]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (rows.length > 1) {
    // Multi-row display math: wrap each row in an mrow
    return { type: 'md', children: rows.map(line => ({ type: 'mrow', value: line })) };
  }
  // Single-expression math (or empty): no mrows, just the content in the value
  return { type: 'md', value: rows[0] ?? '' };
}

/** Handle both display and inline math nodes from custom math parser. */
function convertMathNode(node: CustomMath): M | Md | null {
  if (node.meta === 'inline') {
    // Inline math: $...$ or \(...\)
    return { type: 'm', value: node.value };
  }
  // Display math: $$...$$ or \[...\]
  return convertDisplayMath(node);
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

  const statementChildren = convertBlockSequence(bodyNodes);

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
  converted.push(...convertBlockSequence(children));
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
    case 'math':       return convertMathNode(node as unknown as CustomMath);
    default:           return null;
  }
}
