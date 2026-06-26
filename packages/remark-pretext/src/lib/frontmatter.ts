/**
 * Minimal string-level parser for a leading YAML-style frontmatter block
 * (`---\n...\n---`) used to declare document metadata before any other
 * markdown processing happens. Only `division:`, `xmlid:`, `label:`, and
 * `component:` fields are recognized today; this is intentionally not a
 * general YAML parser.
 */

import { isTopLevelDivisionType } from "@pretextbook/ptxast";
import type { TopLevelDivisionType } from "@pretextbook/ptxast";

export interface FrontmatterResult {
  /** The declared top-level division type, if present and valid. */
  division?: TopLevelDivisionType;
  /** Attributes (`xml:id`, `label`, `component`) for the top-level division. */
  attributes?: Record<string, string>;
  /** The markdown source with the frontmatter block removed. */
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const DIVISION_FIELD_RE = /^division:\s*(\S+)\s*$/m;
const XMLID_FIELD_RE = /^xmlid:\s*(\S+)\s*$/m;
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
  const division =
    divisionValue && isTopLevelDivisionType(divisionValue)
      ? divisionValue
      : undefined;

  const attributes: Record<string, string> = {};
  const xmlid = block.match(XMLID_FIELD_RE)?.[1];
  const label = block.match(LABEL_FIELD_RE)?.[1];
  const component = block.match(COMPONENT_FIELD_RE)?.[1];
  if (xmlid) attributes["xml:id"] = xmlid;
  if (label) attributes["label"] = label;
  if (component) attributes["component"] = component;

  return {
    division,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    body,
  };
}
