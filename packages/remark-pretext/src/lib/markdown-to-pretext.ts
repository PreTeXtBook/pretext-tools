import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import { toXml } from 'xast-util-to-xml';
import remarkPretext from './remark-pretext.js';
import type { RemarkPretextOptions } from './remark-pretext.js';
import type { Root as PtxRoot } from 'xast';

/**
 * Convert a markdown string (with PreTeXt directive extensions) to a PreTeXt
 * XML string.
 *
 * The output contains the converted XML fragment — the children of the root
 * node serialized as a string — suitable for embedding in a PreTeXt document.
 *
 * @param markdown - The markdown source to convert.
 * @param options - Conversion options, e.g. `topLevelDivision`.
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
export function markdownToPretext(
  markdown: string,
  options?: RemarkPretextOptions,
): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkPretext, options);

  const mdast = processor.parse(markdown);
  const ptxast = processor.runSync(mdast, { value: markdown }) as PtxRoot;
  // Self-close empty elements (`<plus:section ref="x"/>`, `<image .../>`) rather
  // than emitting the expanded `<foo></foo>` form — the idiomatic PreTeXt shape.
  return toXml(ptxast.children, {
    closeEmptyElements: true,
    tightClose: true,
  });
}
