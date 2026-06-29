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
import { ptxastToMdast, findTopLevelDivisionInfo } from './ptxast-to-mdast.js';

export { ptxastToMdast } from './ptxast-to-mdast.js';

/**
 * Convert an xast Root (PreTeXt document) to a markdown string using the directive
 * syntax for PreTeXt block environments.
 *
 * A leading frontmatter block is prepended when the outermost division
 * carries information that markdown can't otherwise represent: a
 * `division:` field when it isn't `chapter` (the default a depth-1 heading
 * is assumed to mean), and `xmlid:`/`label:`/`component:` fields mirroring
 * that division's `xml:id`/`label`/`component` attributes.
 */
export function ptxastToMarkdown(root: Root): string {
  const mdast: MdastRoot = ptxastToMdast(root);
  const body = toMarkdown(mdast, {
    extensions: [directiveToMarkdown(), mathToMarkdown()],
  });

  const topLevel = findTopLevelDivisionInfo(root.children as ElementContent[]);
  if (!topLevel) return body;

  const lines: string[] = [];
  if (topLevel.name !== 'chapter') lines.push(`division: ${topLevel.name}`);
  if (topLevel.attributes.xmlid) lines.push(`xmlid: ${topLevel.attributes.xmlid}`);
  if (topLevel.attributes.label) lines.push(`label: ${topLevel.attributes.label}`);
  if (topLevel.attributes.component) lines.push(`component: ${topLevel.attributes.component}`);
  if (lines.length === 0) return body;

  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}
