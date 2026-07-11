/**
 * Minimal string-level parser for a leading YAML-style frontmatter block
 * (`---\n...\n---`) used to declare document metadata before any other
 * markdown processing happens. Only `division:`, `title:`, `xmlid:` (a.k.a.
 * `xml:id:`), `label:`, and `component:` fields are recognized today; this
 * is intentionally not a general YAML parser.
 *
 * `division:` accepts either a heading-producible division (`section`,
 * `worksheet`, ...) or a document root (`book`, `article`, `slideshow`). A
 * root wraps the whole document; its depth-1 headings become the root's
 * outermost child division (see `rootChildDivision`).
 *
 * `title:` sets the title of the document's top-level division (or, when
 * `division:` names a document root, the root's own title). When present,
 * depth-1 headings (`#`) no longer supply that title — they start the first
 * subdivision instead.
 */

import {
  isRootDivisionType,
  isTopLevelDivisionType,
  rootChildDivision,
} from "@pretextbook/ptxast";
import type {
  RootDivisionType,
  TopLevelDivisionType,
} from "@pretextbook/ptxast";

export interface FrontmatterResult {
  /** The division a depth-1 heading (`#`) maps to, if present and valid. When
   * `documentRoot` is set this is the root's outermost child division. */
  division?: TopLevelDivisionType;
  /** The document root (`book`/`article`/`slideshow`) to wrap the whole
   * document in, when `division:` names one. */
  documentRoot?: RootDivisionType;
  /** Attributes (`xml:id`, `label`, `component`) for the top-level division. */
  attributes?: Record<string, string>;
  /** The title of the document's top-level division (or document root),
   * when a `title:` field is present. */
  title?: string;
  /** The markdown source with the frontmatter block removed. */
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const DIVISION_FIELD_RE = /^division:\s*(\S+)\s*$/m;
// Accept all of `id:` `xmlid:` and the `xml:id:` spelling (the PreTeXt attribute name).
const ID_FIELD_RE = /^id:\s*(\S+)\s*$/m;
const XMLID_FIELD_RE = /^xmlid:\s*(\S+)\s*$/m;
const XML_ID_FIELD_RE = /^xml:id:\s*(\S+)\s*$/m;
const LABEL_FIELD_RE = /^label:\s*(\S+)\s*$/m;
const COMPONENT_FIELD_RE = /^component:\s*(\S+)\s*$/m;
// `title:` may contain spaces, so (unlike the scalar fields above) it isn't `\S+`.
const TITLE_FIELD_RE = /^title:\s*(.+?)\s*$/m;

/** Strip a single layer of matching surrounding quotes (YAML-style), if present. */
function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function extractFrontmatter(markdown: string): FrontmatterResult {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) {
    return { body: markdown };
  }

  const block = match[1];
  const body = markdown.slice(match[0].length);

  const divisionValue = block.match(DIVISION_FIELD_RE)?.[1];
  let division: TopLevelDivisionType | undefined;
  let documentRoot: RootDivisionType | undefined;
  if (divisionValue && isRootDivisionType(divisionValue)) {
    documentRoot = divisionValue;
    division = rootChildDivision(divisionValue);
  } else if (divisionValue && isTopLevelDivisionType(divisionValue)) {
    division = divisionValue;
  }

  const attributes: Record<string, string> = {};
  const xmlid =
    block.match(ID_FIELD_RE)?.[1] ??
    block.match(XMLID_FIELD_RE)?.[1] ??
    block.match(XML_ID_FIELD_RE)?.[1];
  const label = block.match(LABEL_FIELD_RE)?.[1];
  const component = block.match(COMPONENT_FIELD_RE)?.[1];
  if (xmlid) attributes["xml:id"] = xmlid;
  if (label) attributes["label"] = label;
  if (component) attributes["component"] = component;

  const titleValue = block.match(TITLE_FIELD_RE)?.[1];
  const title = titleValue ? stripQuotes(titleValue) : undefined;

  return {
    division,
    documentRoot,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    title,
    body,
  };
}
