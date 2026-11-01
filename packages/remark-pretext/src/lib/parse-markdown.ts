/**
 * Parsing markdown into mdast with math already in place.
 *
 * Math is tokenized before the parser sees it, so that its contents aren't read
 * as Markdown; see `tokenizeMathInMarkdown`.
 */

import type { Paragraph, PhrasingContent, Root } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import {
  applyMathTokens,
  restoreMathTokens,
  tokenizeMathInMarkdown,
} from "./math-parser.js";

/** Every Markdown construct that could turn a line into anything but text. */
const FLOW_CONSTRUCTS = [
  "blockQuote",
  "codeFenced",
  "codeIndented",
  "definition",
  "headingAtx",
  "htmlFlow",
  "list",
  "setextUnderline",
  "thematicBreak",
];

export interface ParsedMarkdown<T> {
  tree: T;
  /** The text that was parsed, which node positions are offsets into. */
  source: string;
  /** Turns a slice of `source` back into what the author wrote. */
  restoreSource: (text: string) => string;
}

/** Parse a markdown document, directives included. */
export function parseMarkdown(markdown: string): ParsedMarkdown<Root> {
  const { markdown: source, tokens } = tokenizeMathInMarkdown(markdown);
  // Disable indented code blocks: this markdown dialect uses indentation
  // for Python-style directives, not for code blocks (use fenced ``` instead).
  // Must use processor.data('micromarkExtensions') — remark-parse v11 ignores
  // 'extensions' passed directly as plugin options and only reads from data().
  const parser = unified()
    .data("micromarkExtensions", [{ disable: { null: ["codeIndented"] } }])
    .use(remarkParse)
    .use(remarkDirective);
  const tree = parser.parse(source) as Root;
  applyMathTokens(tree, tokens);
  return {
    tree,
    source,
    restoreSource: (text) => restoreMathTokens(text, tokens),
  };
}

/**
 * Parse a string that can only be inline content, such as a title from
 * frontmatter: `1. Intro` is a title, not a list, and `Groups:Rings` has no
 * directive in it.
 */
export function parseInlineMarkdown(
  markdown: string,
): ParsedMarkdown<PhrasingContent[]> {
  const { markdown: source, tokens } = tokenizeMathInMarkdown(markdown);
  for (const math of tokens.values()) math.meta = "inline";
  const parser = unified()
    .data("micromarkExtensions", [{ disable: { null: FLOW_CONSTRUCTS } }])
    .use(remarkParse);
  const root = parser.parse(source) as Root;
  applyMathTokens(root, tokens);
  return {
    tree: (root.children as Paragraph[]).flatMap((node) => node.children),
    source,
    restoreSource: (text) => restoreMathTokens(text, tokens),
  };
}
