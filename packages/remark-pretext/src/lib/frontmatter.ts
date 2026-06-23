/**
 * Minimal string-level parser for a leading YAML-style frontmatter block
 * (`---\n...\n---`) used to declare document metadata before any other
 * markdown processing happens. Only a single `division: <value>` field is
 * recognized today; this is intentionally not a general YAML parser.
 */

import { isDivisionType } from "@pretextbook/ptxast";
import type { DivisionType } from "@pretextbook/ptxast";

export interface FrontmatterResult {
  /** The declared top-level division type, if present and valid. */
  division?: DivisionType;
  /** The markdown source with the frontmatter block removed. */
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const DIVISION_FIELD_RE = /^division:\s*(\S+)\s*$/m;

export function extractFrontmatter(markdown: string): FrontmatterResult {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) {
    return { body: markdown };
  }

  const block = match[1];
  const body = markdown.slice(match[0].length);
  const fieldMatch = block.match(DIVISION_FIELD_RE);
  const value = fieldMatch?.[1];

  return {
    division: value && isDivisionType(value) ? value : undefined,
    body,
  };
}
