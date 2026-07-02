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
} from "mdast";
import type { ContainerDirective, LeafDirective } from "mdast-util-directive";
import type { Math as CustomMath } from "./math-parser.js";
import { directiveToPlusInclude } from "./plus-include.js";
import type { Root } from "xast";
import type { Element } from "xast";
import { getDirectiveSpec, DIRECTIVE_MAP } from "./directive-map.js";
import { buildDirectiveWithSpec } from "./directive-factory.js";
import type { VisitContext, ConversionMessage } from "./context.js";
import type { RootDivisionType, TopLevelDivisionType } from "@pretextbook/ptxast";
import {
  divisionTypeAtRelativeDepth,
  divisionTypeAtRootDepth,
  isTitlelessDivisionType,
} from "@pretextbook/ptxast";

// ---------------------------------------------------------------------------
// Xast node builders (local helpers for this module)
// ---------------------------------------------------------------------------

type XastText = { type: "text"; value: string };
type XastComment = { type: "comment"; value: string };
type XastChild = Element | XastText | XastComment;

function text(value: string): XastText {
  return { type: "text", value };
}

function el(
  name: string,
  children: XastChild[],
  attributes?: Record<string, string>,
): Element {
  return {
    type: "element",
    name,
    attributes: attributes ?? {},
    children: children as Element["children"],
  };
}

/** Create a value element: single text child holds the raw string content. */
function valueEl(
  name: string,
  value: string,
  attributes?: Record<string, string>,
): Element {
  return el(name, [text(value)], attributes);
}

function comment(value: string): XastComment {
  // XML comments cannot contain '--'; replace to keep output well-formed
  return { type: "comment", value: value.replace(/--/g, "- -") };
}

/** Extract the original source text for a node using its position offsets. */
function nodeSource(node: unknown, ctx: VisitContext): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pos = (node as any)?.position;
  const start: number | undefined = pos?.start?.offset;
  const end: number | undefined = pos?.end?.offset;
  if (ctx.source && start != null && end != null) {
    return ctx.source.slice(start, end);
  }
  return "";
}

/**
 * Build a <TODO> placeholder for unrecognized block content.
 * Structure: <TODO type="..."><!-- todo: ... --><pre>raw source</pre></TODO>
 * The XML comment is compatible with PreTeXt's author.tools="yes" mechanism.
 * The schema-invalid <TODO> element surfaces as a validation error in the LSP.
 */
function todoBlock(type: string, label: string, rawSource: string): Element {
  return el("TODO", [comment(`todo: ${label}`), valueEl("pre", rawSource)], {
    type,
  });
}

/** Build a <TODO> placeholder for unrecognized inline content, using <c> instead of <pre>. */
function todoInline(type: string, label: string, rawSource: string): Element {
  return el("TODO", [comment(`todo: ${label}`), valueEl("c", rawSource)], {
    type,
  });
}

/**
 * Wrap orphaned lists (ul/ol) that don't follow paragraphs in <p> elements.
 * This ensures PreTeXt schema compliance: lists must be inside <p> tags.
 */
function nestListsInParagraphs(elements: Element[]): Element[] {
  const result: Element[] = [];

  for (const elem of elements) {
    if (elem.name === "ul" || elem.name === "ol") {
      if (result.length > 0 && result[result.length - 1]?.name === "p") {
        // Append list to preceding paragraph
        (result[result.length - 1].children as XastChild[]).push(elem);
      } else {
        // Wrap orphaned list in new <p>
        result.push(el("p", [elem]));
      }
    } else {
      result.push(elem);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Result type for conversion: tree + diagnostic messages. */
export interface ConversionResult {
  tree: Root;
  messages: ConversionMessage[];
}

/** Options controlling heading-to-division conversion. */
export interface MdastToPtxastOptions {
  /** The division type that a depth-1 heading (`#`) maps to. Defaults to `'chapter'`. */
  topLevelDivision?: TopLevelDivisionType;
  /** When set, wrap the whole document in this root element
   * (`book`/`article`/`slideshow`); `topLevelDivision` is then the division a
   * depth-1 heading maps to inside the root. */
  documentRoot?: RootDivisionType;
  /** Attributes (`xml:id`, `label`, `component`) applied to the first
   * root-level division built from the document, e.g. from frontmatter. */
  topLevelAttributes?: Record<string, string>;
}

/** Transform an mdast Root node into an xast Root node (backwards compatible). */
export function mdastToPtxast(
  tree: MdastRoot,
  source?: string,
  options?: MdastToPtxastOptions,
): Root {
  const result = mdastToPtxastWithDiagnostics(tree, source, options);
  return result.tree;
}

// keep legacy export name for backwards compatibility
export { mdastToPtxast as mdastToXast };

/** Transform an mdast Root node, returning tree + diagnostic messages. */
export function mdastToPtxastWithDiagnostics(
  tree: MdastRoot,
  source?: string,
  options?: MdastToPtxastOptions,
): ConversionResult {
  const messages: ConversionMessage[] = [];
  const ctx: VisitContext = {
    ancestors: [],
    depth: 0,
    messages,
    source,
    topLevelDivision: options?.topLevelDivision ?? "chapter",
    documentRoot: options?.documentRoot,
    topLevelAttributes: options?.topLevelAttributes,
    topLevelAttributesApplied: options?.topLevelAttributes
      ? { done: false }
      : undefined,
  };
  const nodes = tree.children as Array<BlockContent | DefinitionContent>;

  // A declared document root (`book`/`article`/`slideshow`) wraps the entire
  // document. Its depth-1 headings have already been resolved to the root's
  // outermost child division (`ctx.topLevelDivision`), so the body converts
  // just like a normal document; we only wrap the result and hoist the
  // frontmatter attributes onto the root element itself.
  if (ctx.documentRoot) {
    const attrs = takeTopLevelAttributes(ctx);
    const bodyChildren = nestSections(nodes, ctx);
    const wrapper = el(ctx.documentRoot, bodyChildren, attrs);
    return {
      tree: { type: "root", children: [wrapper] as Root["children"] },
      messages,
    };
  }

  // `introduction`/`conclusion` have no `<title>` in the PreTeXt schema, so
  // they can't be produced from a heading like other divisions. Instead, the
  // whole document becomes their (titleless) body, wrapped in a single
  // top-level element; any headings inside become `paragraphs` divisions
  // (divisionTypeAtRelativeDepth already maps every depth to `paragraphs`
  // for these two types).
  if (isTitlelessDivisionType(ctx.topLevelDivision)) {
    const attrs = takeTopLevelAttributes(ctx);
    const bodyChildren = nestListsInParagraphs(
      nestSections(nodes, { ...ctx, depth: 1 }, true),
    );
    const wrapper = el(ctx.topLevelDivision, bodyChildren, attrs);
    return { tree: { type: "root", children: [wrapper] as Root["children"] }, messages };
  }

  const children = nestSections(nodes, ctx);
  return {
    tree: { type: "root", children: children as Root["children"] },
    messages,
  };
}

// ---------------------------------------------------------------------------
// Section nesting
// ---------------------------------------------------------------------------

/**
 * Partition a flat list of mdast nodes by headings at the minimum heading depth
 * present, recursively nesting deeper headings inside each section.
 * @param wrapOrphanedLists If true, wrap orphaned lists in <p> elements (for division content)
 */
function nestSections(
  nodes: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext,
  wrapOrphanedLists = false,
): Element[] {
  let minDepth = 7;
  for (const node of nodes) {
    if (node.type === "heading")
      minDepth = Math.min(minDepth, (node as Heading).depth);
  }
  if (minDepth === 7) {
    return convertBlockSequence(nodes, ctx, wrapOrphanedLists);
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
    if (node.type === "heading" && (node as Heading).depth === minDepth) {
      if (!currentHeading && preHeadingNodes.length > 0) {
        result.push(
          ...convertBlockSequence(preHeadingNodes, ctx, wrapOrphanedLists),
        );
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
    result.push(
      ...convertBlockSequence(preHeadingNodes, ctx, wrapOrphanedLists),
    );
  }
  flushSection();
  return result;
}

function convertBlockSequence(
  nodes: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext,
  wrapOrphanedLists = false,
): Element[] {
  const result: Element[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];

    const converted = convertBlock(node, ctx);
    if (converted === null) continue;

    // Fold display-math-only paragraphs into paragraph flow.
    if (
      converted.name === "p" &&
      converted.children.length === 1 &&
      (converted.children[0] as Element).name === "md"
    ) {
      const md = converted.children[0] as Element;
      const prev = result[result.length - 1];
      const nextConverted =
        i + 1 < nodes.length ? convertBlock(nodes[i + 1], ctx) : null;
      const nextParagraphChildren =
        nextConverted?.name === "p" ? nextConverted.children : null;

      if (prev?.name === "p") {
        (prev.children as XastChild[]).push(md);
        if (nextParagraphChildren) {
          (prev.children as XastChild[]).push(
            ...(nextParagraphChildren as XastChild[]),
          );
          i += 1;
        }
      } else {
        const children: XastChild[] = [md];
        if (nextParagraphChildren) {
          children.push(...(nextParagraphChildren as XastChild[]));
          i += 1;
        }
        result.push(el("p", children));
      }

      continue;
    }

    // Nest lists inside preceding paragraphs (PreTeXt spec requires lists in <p> tags)
    if (
      (converted.name === "ul" || converted.name === "ol") &&
      result.length > 0
    ) {
      const prev = result[result.length - 1];
      if (prev?.name === "p") {
        // Append list to preceding paragraph
        (prev.children as XastChild[]).push(converted);
        continue;
      }
    }

    result.push(converted);
  }

  // Wrap any remaining orphaned lists only if requested (inside divisions/directives)
  return wrapOrphanedLists ? nestListsInParagraphs(result) : result;
}

function buildDivision(
  heading: Heading,
  body: Array<BlockContent | DefinitionContent>,
  ctx: VisitContext,
): Element {
  // Inside a document root, headings follow that root's hierarchy
  // (`slideshow` in particular nests `section` → `slide`, not
  // `section` → `subsection`); otherwise use the relative hierarchy anchored
  // at `topLevelDivision`.
  const divType = ctx.documentRoot
    ? divisionTypeAtRootDepth(ctx.documentRoot, heading.depth)
    : divisionTypeAtRelativeDepth(ctx.topLevelDivision, heading.depth);
  const titleEl = el("title", convertInlineNodes(heading.children, ctx));
  const attrs = getDivisionAttrs(heading, ctx);
  // Inside divisions, orphaned lists need wrapping (wrapOrphanedLists=true)
  const innerChildren = nestSections(
    body,
    { ...ctx, depth: ctx.depth + 1 },
    true,
  );

  // Also wrap orphaned lists that directly follow the title
  const wrappedChildren = nestListsInParagraphs(innerChildren);

  return el(divType, [titleEl, ...wrappedChildren], attrs);
}

function getHeadingAttrs(heading: Heading): Record<string, string> | undefined {
  const data = heading.data as { id?: string } | undefined;
  return data?.id ? { "xml:id": data.id } : undefined;
}

/**
 * Combine a heading's own `{#id}` attribute with the document's
 * `topLevelAttributes` (e.g. from frontmatter `xmlid`/`label`/`component`).
 * The frontmatter attributes are consumed at most once, on the first
 * root-level division built from the document; the heading's own `{#id}`
 * takes precedence if both set `xml:id`.
 */
function getDivisionAttrs(
  heading: Heading,
  ctx: VisitContext,
): Record<string, string> | undefined {
  const headingAttrs = getHeadingAttrs(heading);
  const frontmatterAttrs = takeTopLevelAttributes(ctx);
  if (!headingAttrs && !frontmatterAttrs) return undefined;
  return { ...frontmatterAttrs, ...headingAttrs };
}

function takeTopLevelAttributes(
  ctx: VisitContext,
): Record<string, string> | undefined {
  if (ctx.depth !== 0) return undefined;
  const tracker = ctx.topLevelAttributesApplied;
  if (!ctx.topLevelAttributes || !tracker || tracker.done) return undefined;
  tracker.done = true;
  return ctx.topLevelAttributes;
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
  containerDirective: (node, ctx) =>
    convertContainerDirective(node as ContainerDirective, ctx),
  leafDirective: (node, ctx) => convertLeafDirective(node as LeafDirective, ctx),
};

function convertBlock(
  node: BlockContent | DefinitionContent,
  ctx: VisitContext,
): Element | null {
  const handler = blockHandlers[node.type];

  if (!handler) {
    if (ctx.messages) {
      ctx.messages.push({
        type: "warning",
        reason: `Unknown block type: ${node.type}`,
        category: "unknown-block-type",
      });
    }
    return todoBlock(
      "unknown-block-type",
      `unknown block type "${node.type}"`,
      nodeSource(node, ctx),
    );
  }

  return handler(node, ctx);
}

function convertParagraph(node: Paragraph, ctx: VisitContext): Element {
  return el("p", convertInlineNodes(node.children, ctx));
}

function convertBlockquote(node: MdastBlockquote, ctx: VisitContext): Element {
  const paragraphs = (node.children as Array<BlockContent | DefinitionContent>)
    .filter((n): n is Paragraph => n.type === "paragraph")
    .map((n) => {
      // Pass blockquote as parent context for its paragraph children
      const childCtx = {
        ...ctx,
        ancestors: [...ctx.ancestors, node],
        depth: ctx.depth + 1,
      };
      return convertParagraph(n, childCtx);
    });
  return el("blockquote", paragraphs);
}

function convertList(node: List, ctx: VisitContext): Element {
  const items = node.children.map((child) => {
    const childCtx = {
      ...ctx,
      ancestors: [...ctx.ancestors, node],
      depth: ctx.depth + 1,
    };
    return convertListItem(child, childCtx);
  });
  return el(node.ordered ? "ol" : "ul", items);
}

function convertListItem(node: ListItem, ctx: VisitContext): Element {
  const children = convertBlockSequence(
    node.children as Array<BlockContent | DefinitionContent>,
    ctx,
  );
  return el("li", children);
}

function convertCode(node: Code, ctx: VisitContext): Element {
  return valueEl(
    "program",
    node.value,
    node.lang ? { language: node.lang } : undefined,
  );
}

function convertDisplayMath(node: CustomMath, ctx: VisitContext): Element {
  const rows = node.value
    .split(/\\\\|[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (rows.length > 1) {
    return el(
      "md",
      rows.map((line) => valueEl("mrow", line)),
    );
  }
  return valueEl("md", rows[0] ?? "");
}

function convertMathNode(node: CustomMath, ctx: VisitContext): Element | null {
  if (node.meta === "inline") {
    return valueEl("m", node.value);
  }
  return convertDisplayMath(node, ctx);
}

// ---------------------------------------------------------------------------
// Leaf directive converters
// ---------------------------------------------------------------------------

/**
 * Convert a leaf directive (`::KIND{ref="id" key=value}`) into a PreTeXt Plus
 * include element (`<plus:KIND ref="id" key=value/>`). Leaf directives are the
 * include syntax for this markdown dialect — a reference to a modular section
 * or asset, expanded by a later assembly step rather than transcluded here.
 *
 * Falls back to the unknown-block placeholder when the directive has no usable
 * name (so nothing is silently dropped).
 */
function convertLeafDirective(
  node: LeafDirective,
  ctx: VisitContext,
): Element | null {
  const include = directiveToPlusInclude(node);
  if (include) return include;
  if (ctx.messages) {
    ctx.messages.push({
      type: "warning",
      reason: `Unnamed leaf directive`,
      category: "unknown-directive",
    });
  }
  return todoBlock(
    "unknown-directive",
    `unnamed leaf directive`,
    nodeSource(node, ctx),
  );
}

// ---------------------------------------------------------------------------
// Container directive converters
// ---------------------------------------------------------------------------

function convertContainerDirective(
  node: ContainerDirective,
  ctx: VisitContext,
): Element | null {
  const spec = getDirectiveSpec(node.name);

  if (!spec) {
    if (ctx.messages) {
      ctx.messages.push({
        type: "warning",
        reason: `Unknown directive: ${node.name}`,
        category: "unknown-directive",
      });
    }
    return todoBlock(
      "unknown-directive",
      `unknown directive "${node.name}"`,
      nodeSource(node, ctx),
    );
  }

  const attrs = buildDirectiveAttrs(node);
  const directiveChildren = node.children as Array<
    BlockContent | DefinitionContent
  >;
  const { title: titleEl, body } = extractDirectiveLabel(
    directiveChildren,
    ctx,
  );

  const childCtx = {
    ...ctx,
    ancestors: [...ctx.ancestors, node],
    depth: ctx.depth + 1,
  };

  // Phase 2: Use factory pattern - single function applies semantic rules from spec
  return buildDirectiveWithSpec(
    spec,
    attrs,
    titleEl,
    body,
    childCtx,
    (child, ctx) => convertBlock(child, ctx),
    (directive, ctx) => convertContainerDirective(directive, ctx),
  );
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
    first?.type === "paragraph" &&
    (first as Paragraph & { data?: { directiveLabel?: boolean } }).data
      ?.directiveLabel === true
  ) {
    return {
      title: el(
        "title",
        convertInlineNodes((first as Paragraph).children, ctx),
      ),
      body: children.slice(1),
    };
  }
  return { title: null, body: children };
}

function buildDirectiveAttrs(
  node: ContainerDirective,
): Record<string, string> | undefined {
  const raw = node.attributes ?? {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    result[k === "id" ? "xml:id" : k] = v;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// Inline converters (using handler dictionary pattern)
// ---------------------------------------------------------------------------

/**
 * Determine if an emphasis node uses underscore (_) or asterisk (*) delimiter.
 * Returns 'underscore' or 'asterisk' based on the source text at the node's position.
 * If source is unavailable, defaults to 'asterisk' for backwards compatibility.
 */
function getEmphasisDelimiter(
  node: Emphasis,
  source?: string,
): "underscore" | "asterisk" {
  if (
    !source ||
    node.position?.start?.offset === null ||
    node.position?.start?.offset === undefined
  ) {
    return "asterisk"; // default
  }
  const delimiter = source.charAt(node.position.start.offset);
  return delimiter === "_" ? "underscore" : "asterisk";
}

/** Dictionary of inline handlers. Maps node type → handler function. */
const inlineHandlers: Record<
  string,
  (node: PhrasingContent, ctx: VisitContext) => XastChild | null
> = {
  text: (node, ctx) => text((node as Text).value),
  emphasis: (node, ctx) => {
    const delim = getEmphasisDelimiter(node as Emphasis, ctx.source);
    const tag = delim === "underscore" ? "term" : "em";
    return el(tag, convertInlineNodes((node as Emphasis).children, ctx));
  },
  strong: (node, ctx) =>
    el("alert", convertInlineNodes((node as Strong).children, ctx)),
  inlineCode: (node, ctx) => valueEl("c", (node as InlineCode).value),
  math: (node, ctx) => convertMathNode(node as unknown as CustomMath, ctx),
};

function convertInlineNodes(
  nodes: PhrasingContent[],
  ctx: VisitContext,
): XastChild[] {
  return nodes
    .flatMap((node) => convertInline(node, ctx))
    .filter((n): n is XastChild => n !== null);
}

function convertInline(
  node: PhrasingContent,
  ctx: VisitContext,
): XastChild | null {
  const handler = inlineHandlers[node.type];

  if (!handler) {
    if (ctx.messages) {
      ctx.messages.push({
        type: "warning",
        reason: `Unknown inline type: ${node.type}`,
        category: "unknown-inline-type",
      });
    }
    return todoInline(
      "unknown-inline-type",
      `unknown inline type "${node.type}"`,
      nodeSource(node, ctx),
    );
  }

  // Pass context with this node added to ancestors, but parent unchanged
  const childCtx = { ...ctx, ancestors: [...ctx.ancestors, node] };
  return handler(node, childCtx);
}
