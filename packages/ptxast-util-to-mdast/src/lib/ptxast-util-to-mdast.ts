/**
 * @pretextbook/ptxast-util-to-mdast
 *
 * Public API for converting an xast Root (PreTeXt document) to mdast and markdown.
 */

import { toMarkdown } from 'mdast-util-to-markdown';
import { directiveToMarkdown } from 'mdast-util-directive';
import { mathToMarkdown } from 'mdast-util-math';
import type { Root as MdastRoot } from 'mdast';
import type { ElementContent, Root } from '@pretextbook/ptxast';
import { ptxastToMdast, findTopLevelDivision } from './ptxast-to-mdast.js';

export { ptxastToMdast } from './ptxast-to-mdast.js';

/**
 * Convert an xast Root (PreTeXt document) to a markdown string using the directive
 * syntax for PreTeXt block environments.
 *
 * When the document's outermost division isn't `chapter` (the default a
 * depth-1 heading is assumed to mean), a `division:` frontmatter block is
 * prepended so the markdown can be converted back to PreTeXt unambiguously.
 */
export function ptxastToMarkdown(root: Root): string {
  const mdast: MdastRoot = ptxastToMdast(root);
  const body = toMarkdown(mdast, {
    extensions: [directiveToMarkdown(), mathToMarkdown()],
  });

  const topLevelDivision = findTopLevelDivision(root.children as ElementContent[]);
  if (!topLevelDivision || topLevelDivision === 'chapter') return body;

  return `---\ndivision: ${topLevelDivision}\n---\n\n${body}`;
}
