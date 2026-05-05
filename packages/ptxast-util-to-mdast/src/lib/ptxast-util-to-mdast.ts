/**
 * @pretextbook/ptxast-util-to-mdast
 *
 * Public API for converting an xast Root (PreTeXt document) to mdast and markdown.
 */

import { toMarkdown } from 'mdast-util-to-markdown';
import { directiveToMarkdown } from 'mdast-util-directive';
import { mathToMarkdown } from 'mdast-util-math';
import type { Root as MdastRoot } from 'mdast';
import type { Root } from 'xast';
import { ptxastToMdast } from './ptxast-to-mdast.js';

export { ptxastToMdast } from './ptxast-to-mdast.js';

/**
 * Convert an xast Root (PreTeXt document) to a markdown string using the directive
 * syntax for PreTeXt block environments.
 */
export function ptxastToMarkdown(root: Root): string {
  const mdast: MdastRoot = ptxastToMdast(root);
  return toMarkdown(mdast, {
    extensions: [directiveToMarkdown(), mathToMarkdown()],
  });
}
