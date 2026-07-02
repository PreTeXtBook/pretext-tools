/**
 * Minimal string-level parser for a leading YAML-style frontmatter block
 * (`---\n...\n---`) used to declare document metadata before any other
 * markdown processing happens. Only `division:`, `xmlid:` (a.k.a. `xml:id:`),
 * `label:`, and `component:` fields are recognized today; this is
 * intentionally not a general YAML parser.
 *
 * `division:` accepts either a heading-producible division (`section`,
 * `worksheet`, ...) or a document root (`book`, `article`, `slideshow`). A
 * root wraps the whole document; its depth-1 headings become the root's
 * outermost child division (see `rootChildDivision`).
 */

import {
  isRootDivisionType,
  isTopLevelDivisionType,
  rootChildDivision,
} from "@pretextbook/ptxast";
import type { RootDivisionType, TopLevelDivisionType } from "@pretextbook/ptxast";

export interface FrontmatterResult {
  /** The division a depth-1 heading (`#`) maps to, if present and valid. When
   * `documentRoot` is set this is the root's outermost child division. */
  division?: TopLevelDivisionType;
  /** The document root (`book`/`article`/`slideshow`) to wrap the whole
   * document in, when `division:` names one. */
  documentRoot?: RootDivisionType;
  /** Attributes (`xml:id`, `label`, `component`) for the top-level division. */
  attributes?: Record<string, string>;
  /** The markdown source with the frontmatter block removed. */
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const DIVISION_FIELD_RE = /^division:\s*(\S+)\s*$/m;
// Accept both `xmlid:` and the `xml:id:` spelling (the PreTeXt attribute name).
const XMLID_FIELD_RE = /^xmlid:\s*(\S+)\s*$/m;
const XML_ID_FIELD_RE = /^xml:id:\s*(\S+)\s*$/m;
const LABEL_FIELD_RE = /^label:\s*(\S+)\s*$/m;
const COMPONENT_FIELD_RE = /^component:\s*(\S+)\s*$/m;

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
    block.match(XMLID_FIELD_RE)?.[1] ?? block.match(XML_ID_FIELD_RE)?.[1];
  const label = block.match(LABEL_FIELD_RE)?.[1];
  const component = block.match(COMPONENT_FIELD_RE)?.[1];
  if (xmlid) attributes["xml:id"] = xmlid;
  if (label) attributes["label"] = label;
  if (component) attributes["component"] = component;

  return {
    division,
    documentRoot,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    body,
  };
}
