/**
 * Parsing markdown into mdast with math already in place.
 *
 * Math is tokenized before the parser sees it, so that its contents aren't read
 * as Markdown; see `tokenizeMathInMarkdown`.
 */

import type { Paragraph, PhrasingContent, Root } from "mdast";
import type { Processor } from "unified";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
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

/**
 * Turn off inline directives, keeping the block ones. They have no PreTeXt
 * meaning yet, and `f:X` in prose or `{#sec:intro}` shouldn't start one. They
 * can't go through `disable` above, since that construct has no name.
 */
function noInlineDirectives(this: Processor): void {
  const data = this.data();
  data.micromarkExtensions = data.micromarkExtensions?.map(
    ({ text, ...extension }) => extension,
  );
}

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
  // Of GFM, only tables are on: strikethrough, autolinks, and footnotes would
  // change how existing documents read.
  const parser = unified()
    .data("micromarkExtensions", [
      { disable: { null: ["codeIndented"] } },
      gfmTable(),
    ])
    .data("fromMarkdownExtensions", [gfmTableFromMarkdown()])
    .use(remarkParse)
    .use(remarkDirective)
    .use(noInlineDirectives);
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
