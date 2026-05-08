import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import { toXml } from 'xast-util-to-xml';
import remarkPretext from './remark-pretext.js';
import type { Root as PtxRoot } from 'xast';

/**
 * Convert a markdown string (with PreTeXt directive extensions) to a PreTeXt
 * XML string.
 *
 * The output contains the converted XML fragment — the children of the root
 * node serialized as a string — suitable for embedding in a PreTeXt document.
 *
 * @param markdown - The markdown source to convert.
 * @returns A PreTeXt XML string.
 *
 * @example
 * ```ts
 * import { markdownToPretext } from '@pretextbook/remark-pretext';
 *
 * const xml = markdownToPretext('# Hello\n\nThis is a paragraph.');
 * // → '<section>\n  <title>Hello</title>\n  <p>This is a paragraph.</p>\n</section>'
 * ```
 */
export function markdownToPretext(markdown: string): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkPretext);

  const mdast = processor.parse(markdown);
  const ptxast = processor.runSync(mdast, { value: markdown }) as PtxRoot;
  return toXml(ptxast.children);
}
