/**
 * remarkPretext — unified plugin that transforms an mdast tree (produced by
 * remark-parse + remark-directive + remark-math) into a ptxast PtxRoot tree.
 *
 * Usage:
 * ```ts
 * import { unified } from 'unified'
 * import remarkParse from 'remark-parse'
 * import remarkDirective from 'remark-directive'
 * import remarkMath from 'remark-math'
 * import remarkPretext from '@pretextbook/remark-pretext'
 *
 * const tree = unified()
 *   .use(remarkParse)
 *   .use(remarkDirective)
 *   .use(remarkMath)
 *   .use(remarkPretext)
 *   .parse(markdownString)
 * ```
 *
 * The output tree is a `PtxRoot` node whose children are the converted
 * ptxast nodes (sections, blocks, directives, etc.).
 */

import type { Plugin } from 'unified';
import type { Root as MdastRoot } from 'mdast';
import type { PtxRoot } from '@pretextbook/ptxast';
import { mdastToPtxast } from './mdast-to-ptxast.js';

/** Options for the remark-pretext plugin (currently none, reserved for future use). */
export interface RemarkPretextOptions {}

const remarkPretext: Plugin<[RemarkPretextOptions?], MdastRoot, PtxRoot> = function () {
  return function transformer(tree: MdastRoot): PtxRoot {
    return mdastToPtxast(tree);
  };
};

export default remarkPretext;
export { mdastToPtxast } from './mdast-to-ptxast.js';
export { DIRECTIVE_MAP, PROOF_SOLUTION_NAMES } from './directive-map.js';
export type { DirectiveInfo, DirectiveCategory } from './directive-map.js';
