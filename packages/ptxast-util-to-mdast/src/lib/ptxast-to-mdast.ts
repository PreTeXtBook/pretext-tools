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
  Link,
  List,
  ListItem,
  Code,
  Blockquote as MdastBlockquote,
  Html,
  Table,
  TableRow,
  TableCell,
  AlignType,
} from "mdast";
import { toXml } from "xast-util-to-xml";
import type { ContainerDirective } from "mdast-util-directive";
import type { Math as MdastMath, InlineMath } from "mdast-util-math";
import type { Root, Element, ElementContent } from "@pretextbook/ptxast";
import {
  getPtxTextContent,
  DIVISION_HIERARCHY,
  EXTRA_DIVISION_TYPES,
  TITLELESS_DIVISION_TYPES as TITLELESS_DIVISION_TYPE_LIST,
  isTitlelessDivisionType,
} from "@pretextbook/ptxast";

// ---------------------------------------------------------------------------
// Division metadata
// ---------------------------------------------------------------------------

// Division-like types that are heading-mappable on the way back to markdown
// (they have a <title>, so they become a heading). `introduction`/
// `conclusion` are excluded here — see TITLELESS_DIVISION_TYPES below.
export const DIVISION_TYPE_NAMES = new Set<string>([
  ...DIVISION_HIERARCHY,
  ...EXTRA_DIVISION_TYPES.filter((name) => !isTitlelessDivisionType(name)),
]);

// `introduction`/`conclusion` have no <title> in the PreTeXt schema, so they
// never become a heading: their content is spliced into the surrounding flow
// (and the heading depth they'd otherwise consume is left untouched).
export const TITLELESS_DIVISION_TYPES = new Set<string>(
  TITLELESS_DIVISION_TYPE_LIST,
);

/**
 * Structural container types whose content should be recursed into
 * without emitting a heading, and without changing the current depth.
 * This handles full ptxast trees that include a `pretext > book > chapter`
 * hierarchy.
 */
export const TRANSPARENT_TYPES = new Set([
  "pretext",
  "book",
  "article",
  "slideshow",
  "frontmatter",
  "backmatter",
]);

// ---------------------------------------------------------------------------
// Directive type metadata  (mirrors directive-map.ts in remark-pretext)
// ---------------------------------------------------------------------------

type DirectiveCategory =
  | "theorem-like" // has <statement> wrapper + optional proof children
  | "definition-like" // has <statement> wrapper
  | "remark-like" // no statement wrapper, direct block children
  | "example-like" // no statement wrapper
  | "proof-like" // no statement wrapper
  | "solution-like" // no statement wrapper
  | "figure-like"; // no statement wrapper

interface DirectiveMeta {
  name: string;
  category: DirectiveCategory;
}

const TYPE_TO_DIRECTIVE = new Map<string, DirectiveMeta>([
  // theorem-like
  ["theorem", { name: "theorem", category: "theorem-like" }],
  ["lemma", { name: "lemma", category: "theorem-like" }],
  ["corollary", { name: "corollary", category: "theorem-like" }],
  ["proposition", { name: "proposition", category: "theorem-like" }],
  ["claim", { name: "claim", category: "theorem-like" }],
  ["fact", { name: "fact", category: "theorem-like" }],
  ["conjecture", { name: "conjecture", category: "theorem-like" }],
  ["axiom", { name: "axiom", category: "theorem-like" }],
  ["principle", { name: "principle", category: "theorem-like" }],
  ["hypothesis", { name: "hypothesis", category: "theorem-like" }],
  ["algorithm", { name: "algorithm", category: "theorem-like" }],
  // definition-like
  ["definition", { name: "definition", category: "definition-like" }],
  ["notation", { name: "notation", category: "definition-like" }],
  // remark-like
  ["remark", { name: "remark", category: "remark-like" }],
  ["note", { name: "note", category: "remark-like" }],
  ["observation", { name: "observation", category: "remark-like" }],
  ["warning", { name: "warning", category: "remark-like" }],
  ["insight", { name: "insight", category: "remark-like" }],
  ["assemblage", { name: "assemblage", category: "remark-like" }],
  // example-like
  ["example", { name: "example", category: "example-like" }],
  ["question", { name: "question", category: "example-like" }],
  ["problem", { name: "problem", category: "example-like" }],
  ["exercise", { name: "exercise", category: "example-like" }],
  ["activity", { name: "activity", category: "example-like" }],
  ["exploration", { name: "exploration", category: "example-like" }],
  ["investigation", { name: "investigation", category: "example-like" }],
  ["project", { name: "project", category: "example-like" }],
  // proof-like
  ["proof", { name: "proof", category: "proof-like" }],
  ["case", { name: "case", category: "proof-like" }],
  // solution-like
  ["solution", { name: "solution", category: "solution-like" }],
  ["hint", { name: "hint", category: "solution-like" }],
  ["answer", { name: "answer", category: "solution-like" }],
  // figure-like: a titled wrapper; `:::table[Title]` around a pipe table
  ["table", { name: "table", category: "figure-like" }],
]);

// theorem-like and definition-like wrap body in <statement>
const HAS_STATEMENT_WRAPPER = new Set(["theorem-like", "definition-like"]);

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Convert an xast Root (PreTeXt document) to an mdast Root. */
export function ptxastToMdast(root: Root): MdastRoot {
  return {
    type: "root",
    children: flattenChildren(root.children as ElementContent[], 1),
  };
}

/** The outermost division's name plus the subset of its attributes that
 * round-trip through markdown frontmatter (`xmlid`, `label`, `component`). */
export interface TopLevelDivisionInfo {
  name: string;
  attributes: {
    xmlid?: string;
    label?: string;
    component?: string;
  };
}

/**
 * Find the outermost division in a ptxast tree (skipping transparent
 * structural wrappers), i.e. the division a depth-1 heading would represent
 * if this tree were flattened to markdown — along with its `xml:id`/
 * `label`/`component` attributes, for round-tripping into frontmatter.
 */
export function findTopLevelDivisionInfo(
  nodes: ElementContent[],
): TopLevelDivisionInfo | undefined {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    const el = node as Element;
    if (
      DIVISION_TYPE_NAMES.has(el.name) ||
      TITLELESS_DIVISION_TYPES.has(el.name)
    ) {
      const attrs = el.attributes ?? {};
      const attributes: TopLevelDivisionInfo["attributes"] = {};
      if (attrs["xml:id"]) attributes.xmlid = attrs["xml:id"];
      if (attrs["label"]) attributes.label = attrs["label"];
      if (attrs["component"]) attributes.component = attrs["component"];
      return { name: el.name, attributes };
    }
    if (TRANSPARENT_TYPES.has(el.name)) {
      const found = findTopLevelDivisionInfo(el.children);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Find the name of the outermost division in a ptxast tree (skipping
 * transparent structural wrappers), i.e. the division a depth-1 heading
 * would represent if this tree were flattened to markdown.
 */
export function findTopLevelDivision(
  nodes: ElementContent[],
): string | undefined {
  return findTopLevelDivisionInfo(nodes)?.name;
}

// ---------------------------------------------------------------------------
// Flattening divisions into heading + flat content
// ---------------------------------------------------------------------------

/**
 * Convert an array of xast ElementContent nodes to mdast. `depth` (1-based,
 * clamped to 6) is the heading depth that the next division encountered at
 * this level should use; nested divisions go one level deeper.
 */
function flattenChildren(
  nodes: ElementContent[],
  depth: number,
): MdastContent[] {
  const result: MdastContent[] = [];
  for (const node of nodes) {
    if (node.type !== "element") continue;
    const el = node as Element;
    if (
      TRANSPARENT_TYPES.has(el.name) ||
      TITLELESS_DIVISION_TYPES.has(el.name)
    ) {
      result.push(...flattenChildren(el.children, depth));
    } else if (DIVISION_TYPE_NAMES.has(el.name)) {
      result.push(
        ...flattenDivision(el, Math.min(depth, 6) as 1 | 2 | 3 | 4 | 5 | 6),
      );
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
    (c) => c.type === "element" && (c as Element).name === "title",
  ) as Element | undefined;
  const restChildren = children.filter(
    (c) => !(c.type === "element" && (c as Element).name === "title"),
  );

  const { "xml:id": id, ...attributes } = attrs;
  const heading: Heading = {
    type: "heading",
    depth,
    children: titleNode
      ? titleNode.children.map(convertInlineNode).filter(notNull)
      : [],
    ...(id ? { data: { id, attributes, hProperties: { id } } } : {}),
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
    case "p":
      return convertP(el);
    case "blockquote":
      return convertBlockquote(el);
    case "ol":
      return convertList(el, true);
    case "ul":
      return convertList(el, false);
    case "program":
      return convertProgram(el);
    case "tabular":
      return convertTabular(el);
    case "me":
    case "men":
    case "md":
    case "mdn":
      return convertDisplayMath(el);
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
    type: "paragraph",
    children: el.children.map(convertInlineNode).filter(notNull),
  };
}

// ── Blockquote ───────────────────────────────────────────────────────────────

function convertBlockquote(el: Element): MdastBlockquote {
  return {
    type: "blockquote",
    children: el.children
      .filter((c) => c.type === "element")
      .map((c) => convertBlock(c as Element))
      .filter(notNull) as BlockContent[],
  };
}

// ── Lists ─────────────────────────────────────────────────────────────────────

function convertList(el: Element, ordered: boolean): List {
  return {
    type: "list",
    ordered,
    spread: false,
    children: el.children
      .filter((c) => c.type === "element")
      .map((c) => convertListItem(c as Element)),
  };
}

function convertListItem(el: Element): ListItem {
  return {
    type: "listItem",
    spread: false,
    children: el.children
      .filter((c) => c.type === "element")
      .map((c) => convertBlock(c as Element))
      .filter(notNull) as BlockContent[],
  };
}

// ── Code / program ───────────────────────────────────────────────────────────

function convertProgram(el: Element): Code {
  const attrs = el.attributes ?? {};
  return {
    type: "code",
    lang: attrs["language"] ?? null,
    value: getPtxTextContent(el),
  };
}

// ── Tables ───────────────────────────────────────────────────────────────────

const PIPE_TABLE_ALIGN = new Set(["left", "center", "right"]);

/**
 * A `<tabular>` becomes a GFM pipe table when a pipe table can say everything
 * it says: alignment (`halign` on the tabular or its `<col>`s), a header on the
 * first row only, and cells of inline content. Anything else — borders,
 * widths, `colspan`, `<p>`/`<line>` in cells, vertical headers — is kept
 * whole as raw PreTeXt, which `remark-pretext` passes straight through.
 *
 * A pipe table must have a header row, so a `<tabular>` without one gets an
 * empty header, which `remark-pretext` reads back as no header at all.
 */
function convertTabular(el: Element): Table | Html {
  return tabularToTable(el) ?? { type: "html", value: rawBlockXml(el) };
}

const XML_OPTIONS = { closeEmptyElements: true, tightClose: true } as const;

/**
 * Serialize an element as a raw PreTeXt block: its opening tag alone on the
 * first line (CommonMark only starts an HTML block at a line holding nothing
 * but a tag), then each child on its own line.
 */
function rawBlockXml(el: Element): string {
  const children = el.children.filter(
    (c) => !(c.type === "text" && /^\s*$/.test(c.value)),
  );
  if (children.length === 0 || children.some((c) => c.type === "text")) {
    return toXml(el as never, XML_OPTIONS);
  }
  const shell = toXml({ ...el, children: [] } as never, XML_OPTIONS);
  const open = shell.replace(/\/>$/, ">");
  const body = children.map((c) => `  ${toXml(c as never, XML_OPTIONS)}`);
  return [open, ...body, `</${el.name}>`].join("\n");
}

function tabularToTable(el: Element): Table | null {
  const { halign, ...rest } = el.attributes ?? {};
  if (!onlyKnownAttributes(rest)) return null;
  if (halign != null && !PIPE_TABLE_ALIGN.has(halign)) return null;

  const children = elementChildren(el);
  const cols = children.filter((c) => c.name === "col");
  const rows = children.filter((c) => c.name === "row");
  if (rows.length === 0 || cols.length + rows.length !== children.length) {
    return null;
  }
  // `<col>`s come first in the schema; anything else is out of our depth.
  if (children.findIndex((c) => c.name === "row") !== cols.length) return null;

  const colAlign: AlignType[] = [];
  for (const col of cols) {
    const { halign: colHalign, ...colRest } = col.attributes ?? {};
    if (!onlyKnownAttributes(colRest)) return null;
    if (colHalign != null && !PIPE_TABLE_ALIGN.has(colHalign)) return null;
    colAlign.push((colHalign ?? halign ?? null) as AlignType);
  }

  const tableRows: TableRow[] = [];
  let hasHeader = false;
  for (const [index, row] of rows.entries()) {
    const { header, ...rowRest } = row.attributes ?? {};
    if (!onlyKnownAttributes(rowRest)) return null;
    if (header === "yes") {
      if (index !== 0) return null;
      hasHeader = true;
    } else if (header != null && header !== "no") {
      return null;
    }
    const tableRow = rowToTableRow(row);
    if (!tableRow) return null;
    tableRows.push(tableRow);
  }

  const width = Math.max(
    cols.length,
    ...tableRows.map((row) => row.children.length),
  );
  if (width === 0) return null;
  if (!hasHeader) tableRows.unshift({ type: "tableRow", children: [] });
  for (const row of tableRows) {
    while (row.children.length < width) {
      row.children.push({ type: "tableCell", children: [] });
    }
  }

  const align = Array.from(
    { length: width },
    (_, i): AlignType => colAlign[i] ?? ((halign ?? null) as AlignType),
  );
  return { type: "table", align, children: tableRows };
}

function rowToTableRow(row: Element): TableRow | null {
  const children = row.children.filter(
    (c) => !(c.type === "text" && /^\s*$/.test(c.value)),
  );
  const cells: TableCell[] = [];
  for (const cell of children) {
    if (cell.type !== "element" || cell.name !== "cell") return null;
    if (!onlyKnownAttributes(cell.attributes ?? {})) return null;
    const content = cellContent(cell);
    if (!content) return null;
    cells.push({ type: "tableCell", children: content });
  }
  return { type: "tableRow", children: cells };
}

/**
 * The inline content of a `<cell>`, on one line, or null if any of it has no
 * Markdown form (so the table must stay raw rather than lose it).
 */
function cellContent(cell: Element): PhrasingContent[] | null {
  const result: PhrasingContent[] = [];
  for (const child of cell.children) {
    if (child.type === "comment") continue;
    const converted = convertInlineNode(child);
    if (!converted) return null;
    if (converted.type === "text") {
      converted.value = converted.value.replace(/\s+/g, " ");
    }
    result.push(converted);
  }
  const first = result[0];
  if (first?.type === "text") first.value = first.value.trimStart();
  const last = result[result.length - 1];
  if (last?.type === "text") last.value = last.value.trimEnd();
  return result.filter((node) => node.type !== "text" || node.value !== "");
}

function onlyKnownAttributes(rest: Record<string, unknown>): boolean {
  return Object.values(rest).every((value) => value == null);
}

function elementChildren(el: Element): Element[] {
  const result: Element[] = [];
  for (const child of el.children) {
    if (child.type === "element") result.push(child as Element);
    else if (child.type === "text" && !/^\s*$/.test(child.value)) return [];
  }
  return result;
}

// ── Display math ─────────────────────────────────────────────────────────────

function convertDisplayMath(el: Element): MdastMath {
  const children = el.children;
  // Single-line: first child is a Text node
  if (children.length > 0 && children[0].type === "text") {
    return { type: "math", value: getPtxTextContent(el) };
  }
  // Multi-line: mrow elements
  const value = children
    .filter(
      (child) => child.type === "element" && (child as Element).name === "mrow",
    )
    .map((child) => getPtxTextContent(child as Element))
    .join(" \\\\\n");
  return { type: "math", value };
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
  if (attrs["xml:id"]) directiveAttrs["id"] = attrs["xml:id"];
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "xml:id" || v == null) continue;
    directiveAttrs[k] = v as string;
  }

  const titleNode = children.find(
    (c: ElementContent) =>
      c.type === "element" && (c as Element).name === "title",
  ) as Element | undefined;

  const directiveChildren: (BlockContent | DefinitionContent)[] = [];

  if (titleNode) {
    const labelPara: Paragraph & { data: { directiveLabel: boolean } } = {
      type: "paragraph",
      data: { directiveLabel: true },
      children: titleNode.children.map(convertInlineNode).filter(notNull),
    };
    directiveChildren.push(labelPara);
  }

  if (HAS_STATEMENT_WRAPPER.has(meta.category)) {
    for (const child of children) {
      if (child.type !== "element") continue;
      const childEl = child as Element;
      if (childEl.name === "title") continue;
      if (childEl.name === "statement") {
        for (const sc of childEl.children) {
          if (sc.type !== "element") continue;
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
      if (child.type !== "element") continue;
      const childEl = child as Element;
      if (childEl.name === "title") continue;
      const c = convertBlock(childEl);
      if (c) directiveChildren.push(c);
    }
  }

  return {
    type: "containerDirective",
    name: meta.name,
    attributes:
      Object.keys(directiveAttrs).length > 0 ? directiveAttrs : undefined,
    children: directiveChildren,
  } as unknown as ContainerDirective;
}

// ---------------------------------------------------------------------------
// Inline converters
// ---------------------------------------------------------------------------

function convertInlineNode(node: ElementContent): PhrasingContent | null {
  if (node.type === "text") {
    return {
      type: "text",
      value: (node as { value: string }).value ?? "",
    } as Text;
  }
  if (node.type !== "element") return null;
  const el = node as Element;
  switch (el.name) {
    case "em":
      return {
        type: "emphasis",
        children: el.children.map(convertInlineNode).filter(notNull),
      } as Emphasis;
    case "alert":
      return {
        type: "strong",
        children: el.children.map(convertInlineNode).filter(notNull),
      } as Strong;
    case "c":
      return { type: "inlineCode", value: getPtxTextContent(el) } as InlineCode;
    case "m":
      return { type: "inlineMath", value: getPtxTextContent(el) } as InlineMath;
    case "xref":
      return convertXref(el);
    default:
      return null;
  }
}

/**
 * A plain reference to one id is the link `[text](#id)`. Anything else an
 * `<xref>` can say (`text=`, `first`/`last`, a list of ids) has no Markdown form.
 */
function convertXref(el: Element): Link | null {
  const attrs = el.attributes ?? {};
  const ref = attrs["ref"];
  if (!ref || /[\s,]/.test(ref) || Object.keys(attrs).length > 1) return null;
  return {
    type: "link",
    url: `#${ref}`,
    children: el.children.map(convertInlineNode).filter(notNull),
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function notNull<T>(value: T | null): value is T {
  return value !== null;
}
