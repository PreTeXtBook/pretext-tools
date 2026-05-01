/**
 * @pretextbook/ptxast-util-to-mdast
 *
 * Public API for converting ptxast to mdast and markdown.
 */

import { toMarkdown } from 'mdast-util-to-markdown';
import { directiveToMarkdown } from 'mdast-util-directive';
import { mathToMarkdown } from 'mdast-util-math';
import type { Root as MdastRoot } from 'mdast';
import type { PtxRoot } from '@pretextbook/ptxast';
import { ptxastToMdast } from './ptxast-to-mdast.js';

export { ptxastToMdast } from './ptxast-to-mdast.js';

/**
 * Convert a ptxast PtxRoot to a markdown string using the directive syntax
 * for PreTeXt block environments.
 */
export function ptxastToMarkdown(root: PtxRoot): string {
  const mdast: MdastRoot = ptxastToMdast(root);
  return toMarkdown(mdast, {
    extensions: [directiveToMarkdown(), mathToMarkdown()],
  });
}
