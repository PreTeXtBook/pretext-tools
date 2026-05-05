/**
 * mdast-to-xast: transforms an mdast Root into an xast Root containing
 * PreTeXt element nodes.
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

/** Transform an mdast Root node into an xast Root node. */
export function mdastToPtxast(tree: MdastRoot): Root {
  const nodes = tree.children as Array<BlockContent | DefinitionContent>;
  const children = nestSections(nodes);
  return { type: 'root', children: children as Root['children'] };
}

// keep legacy export name for backwards compatibility
export { mdastToPtxast as mdastToXast };

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
function nestSections(nodes: Array<BlockContent | DefinitionContent>): Element[] {
  let minDepth = 7;
  for (const node of nodes) {
    if (node.type === 'heading') minDepth = Math.min(minDepth, (node as Heading).depth);
  }
  if (minDepth === 7) {
    return convertBlockSequence(nodes);
  }

  const result: Element[] = [];
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
      preHeadingNodes.push(node);
    }
  }
  if (!currentHeading && preHeadingNodes.length > 0) {
    result.push(...convertBlockSequence(preHeadingNodes));
  }
  flushSection();
  return result;
}

function convertBlockSequence(nodes: Array<BlockContent | DefinitionContent>): Element[] {
  const result: Element[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];

    const converted = convertBlock(node);
    if (converted === null) continue;

    // Fold display-math-only paragraphs into paragraph flow.
    if (
      converted.name === 'p' &&
      converted.children.length === 1 &&
      (converted.children[0] as Element).name === 'md'
    ) {
      const md = converted.children[0] as Element;
      const prev = result[result.length - 1];
      const nextConverted = i + 1 < nodes.length ? convertBlock(nodes[i + 1]) : null;
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
  body: Array<BlockContent | DefinitionContent>
): Element {
  const divType = depthToType(heading.depth);
  const titleEl = el('title', convertInlineNodes(heading.children));
  const attrs = getHeadingAttrs(heading);
  const innerChildren = nestSections(body);

  return el(divType, [titleEl, ...innerChildren], attrs);
}

function getHeadingAttrs(heading: Heading): Record<string, string> | undefined {
  const data = heading.data as { id?: string } | undefined;
  return data?.id ? { 'xml:id': data.id } : undefined;
}

// ---------------------------------------------------------------------------
// Block converters
// ---------------------------------------------------------------------------

function convertBlock(node: BlockContent | DefinitionContent): Element | null {
  switch (node.type) {
    case 'paragraph':          return convertParagraph(node as Paragraph);
    case 'blockquote':         return convertBlockquote(node as MdastBlockquote);
    case 'list':               return convertList(node as List);
    case 'code':               return convertCode(node as Code);
    case 'containerDirective': return convertContainerDirective(node as ContainerDirective);
    default:                   return null;
  }
}

function convertParagraph(node: Paragraph): Element {
  return el('p', convertInlineNodes(node.children));
}

function convertBlockquote(node: MdastBlockquote): Element {
  const paragraphs = (node.children as Array<BlockContent | DefinitionContent>)
    .filter((n): n is Paragraph => n.type === 'paragraph')
    .map(convertParagraph);
  return el('blockquote', paragraphs);
}

function convertList(node: List): Element {
  const items = node.children.map(convertListItem);
  return el(node.ordered ? 'ol' : 'ul', items);
}

function convertListItem(node: ListItem): Element {
  const children = convertBlockSequence(node.children as Array<BlockContent | DefinitionContent>);
  return el('li', children);
}

function convertCode(node: Code): Element {
  return valueEl('program', node.value, node.lang ? { language: node.lang } : undefined);
}

function convertDisplayMath(node: CustomMath): Element {
  const rows = node.value
    .split(/\\\\|[\r\n]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (rows.length > 1) {
    return el('md', rows.map(line => valueEl('mrow', line)));
  }
  return valueEl('md', rows[0] ?? '');
}

function convertMathNode(node: CustomMath): Element | null {
  if (node.meta === 'inline') {
    return valueEl('m', node.value);
  }
  return convertDisplayMath(node);
}

// ---------------------------------------------------------------------------
// Container directive converters
// ---------------------------------------------------------------------------

function convertContainerDirective(node: ContainerDirective): Element | null {
  const info = DIRECTIVE_MAP[node.name];
  if (!info) return null;

  const attrs = buildDirectiveAttrs(node);
  const directiveChildren = node.children as Array<BlockContent | DefinitionContent>;
  const { title: titleEl, body } = extractDirectiveLabel(directiveChildren);

  switch (info.category) {
    case 'theorem-like':
    case 'definition-like':
      return buildTheoremLike(info.type, attrs, titleEl, body);
    case 'remark-like':
    case 'proof-like':
    case 'solution-like':
      return buildContentBlock(info.type, attrs, titleEl, body);
    case 'example-like':
      return buildExampleLike(info.type, attrs, titleEl, body);
  }
}

function extractDirectiveLabel(children: Array<BlockContent | DefinitionContent>): {
  title: Element | null;
  body: Array<BlockContent | DefinitionContent>;
} {
  const first = children[0];
  if (
    first?.type === 'paragraph' &&
    (first as Paragraph & { data?: { directiveLabel?: boolean } }).data?.directiveLabel === true
  ) {
    return {
      title: el('title', convertInlineNodes((first as Paragraph).children)),
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
  children: Array<BlockContent | DefinitionContent>
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

  const statementChildren = convertBlockSequence(bodyNodes);

  const result: Element[] = [];
  if (titleEl) result.push(titleEl);
  if (statementChildren.length > 0) {
    result.push(el('statement', statementChildren));
  }
  for (const pd of proofNodes) {
    const converted = convertContainerDirective(pd);
    if (converted) result.push(converted);
  }

  return el(type, result, attrs);
}

function buildContentBlock(
  type: string,
  attrs: Record<string, string> | undefined,
  titleEl: Element | null,
  children: Array<BlockContent | DefinitionContent>
): Element {
  const converted: Element[] = [];
  if (titleEl) converted.push(titleEl);
  converted.push(...convertBlockSequence(children));
  return el(type, converted, attrs);
}

function buildExampleLike(
  type: string,
  attrs: Record<string, string> | undefined,
  titleEl: Element | null,
  children: Array<BlockContent | DefinitionContent>
): Element {
  return buildContentBlock(type, attrs, titleEl, children);
}

// ---------------------------------------------------------------------------
// Inline converters
// ---------------------------------------------------------------------------

function convertInlineNodes(nodes: PhrasingContent[]): XastChild[] {
  return nodes.flatMap(convertInline).filter((n): n is XastChild => n !== null);
}

function convertInline(node: PhrasingContent): XastChild | null {
  switch (node.type) {
    case 'text':       return text((node as Text).value);
    case 'emphasis':   return el('em', convertInlineNodes((node as Emphasis).children));
    case 'strong':     return el('alert', convertInlineNodes((node as Strong).children));
    case 'inlineCode': return valueEl('c', (node as InlineCode).value);
    case 'math':       return convertMathNode(node as unknown as CustomMath);
    default:           return null;
  }
}
