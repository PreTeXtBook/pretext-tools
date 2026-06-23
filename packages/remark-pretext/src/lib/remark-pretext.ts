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
import type { Root } from 'xast';
import type { DivisionType } from '@pretextbook/ptxast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import { mdastToPtxast } from './mdast-to-ptxast.js';
import { applyMathDelimiters, applyMathTokens, tokenizeMathInMarkdown } from './math-parser.js';
import { normalizeDirectiveColons } from './directive-normalizer.js';
import { normalizeIndentationDirectives } from './indentation-normalizer.js';
import { extractFrontmatter } from './frontmatter.js';

/** Options for the remark-pretext plugin. */
export interface RemarkPretextOptions {
  /**
   * The division type that a depth-1 heading (`#`) maps to. Overrides any
   * `division:` field declared in the markdown's frontmatter. Defaults to
   * `'chapter'` (matching historical behavior) when neither is set.
   */
  topLevelDivision?: DivisionType;
}

const remarkPretext: Plugin<[RemarkPretextOptions?], MdastRoot, Root> = function (
  options?: RemarkPretextOptions,
) {
  return function transformer(tree: MdastRoot, file?: { value?: unknown }): Root {
    // Preferred path: tokenize raw markdown first so LaTeX delimiters are parsed
    // from source text (no heuristic inference from parsed text nodes).
    if (typeof file?.value === 'string') {
      const frontmatter = extractFrontmatter(file.value);
      const topLevelDivision =
        options?.topLevelDivision ?? frontmatter.division ?? 'chapter';

      // Pipeline: indentation→colons→directive-normalize→math-tokenize→reparse
      const indentNormalized = normalizeIndentationDirectives(frontmatter.body);
      const normalized = normalizeDirectiveColons(indentNormalized);
      const tokenized = tokenizeMathInMarkdown(normalized);
      // Disable indented code blocks: this markdown dialect uses indentation
      // for Python-style directives, not for code blocks (use fenced ``` instead).
      // Must use processor.data('micromarkExtensions') — remark-parse v11 ignores
      // 'extensions' passed directly as plugin options and only reads from data().
      const parser = unified()
        .data('micromarkExtensions', [{ disable: { null: ['codeIndented'] } }])
        .use(remarkParse)
        .use(remarkDirective);
      const reparsed = parser.parse(tokenized.markdown) as MdastRoot;
      applyMathTokens(reparsed, tokenized.tokens);
      // pass tokenized source for delimiter detection
      return mdastToPtxast(reparsed, tokenized.markdown, { topLevelDivision });
    }

    // Fallback for parse+runSync(tree) usage where raw source text is unavailable.
    applyMathDelimiters(tree);
    return mdastToPtxast(tree, undefined, {
      topLevelDivision: options?.topLevelDivision ?? 'chapter',
    });
  };
};

export default remarkPretext;
export { mdastToPtxast } from './mdast-to-ptxast.js';
export { DIRECTIVE_MAP, PROOF_SOLUTION_NAMES } from './directive-map.js';
export type { DirectiveInfo, DirectiveCategory } from './directive-map.js';
