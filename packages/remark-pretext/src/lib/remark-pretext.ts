/**
 * remarkPretext — unified plugin that transforms an mdast tree (produced by
 * remark-parse + remark-directive) into a ptxast PtxRoot tree.
 *
 * Usage:
 * ```ts
 * import { unified } from 'unified'
 * import remarkParse from 'remark-parse'
 * import remarkDirective from 'remark-directive'
 * import { remarkPretext } from '@pretextbook/remark-pretext'
 *
 * const processor = unified()
 *   .use(remarkParse)
 *   .use(remarkDirective)
 *   .use(remarkPretext)
 *
 * const mdast = processor.parse(markdownString)
 * const ptxast = processor.runSync(mdast) // PtxRoot
 * ```
 *
 * The output tree is a `PtxRoot` node whose children are the converted
 * ptxast nodes (sections, blocks, directives, etc.).
 */

import type { Plugin } from 'unified';
import type { Root as MdastRoot } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import type { PtxRoot } from '@pretextbook/ptxast';
import { mdastToPtxast } from './mdast-to-ptxast.js';
import { applyMathDelimiters, applyMathTokens, tokenizeMathInMarkdown } from './math-parser.js';

/** Options for the remark-pretext plugin (currently none, reserved for future use). */
export interface RemarkPretextOptions {}

const remarkPretext: Plugin<[RemarkPretextOptions?], MdastRoot, PtxRoot> = function () {
  return function transformer(tree: MdastRoot, file?: { value?: unknown }): PtxRoot {
    // Preferred path: tokenize raw markdown first so LaTeX delimiters are parsed
    // from source text (no heuristic inference from parsed text nodes).
    if (typeof file?.value === 'string') {
      const tokenized = tokenizeMathInMarkdown(file.value);
      const parser = unified().use(remarkParse).use(remarkDirective);
      const reparsed = parser.parse(tokenized.markdown) as MdastRoot;
      applyMathTokens(reparsed, tokenized.tokens);
      return mdastToPtxast(reparsed);
    }

    // Fallback for parse+runSync(tree) usage where raw source text is unavailable.
    applyMathDelimiters(tree);
    return mdastToPtxast(tree);
  };
};

export default remarkPretext;
export { mdastToPtxast } from './mdast-to-ptxast.js';
export { DIRECTIVE_MAP, PROOF_SOLUTION_NAMES } from './directive-map.js';
export type { DirectiveInfo, DirectiveCategory } from './directive-map.js';
