// Small pure helpers shared by the legacy file splitter
// (build-project-files.ts) and the division-pool builder/serializers
// (lib/pool/).

import { renderXmlProlog } from './templates';

export const XI_NAMESPACE = 'http://www.w3.org/2001/XInclude';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function padIndex(index: number, total: number): string {
  const width = String(total).length;
  return String(index).padStart(Math.max(width, 2), '0');
}

/** Replace each [start, end) span of `source` with its replacement string. */
export function spliceReplacements(
  source: string,
  replacements: Array<{ start: number; end: number; replacement: string }>,
): string {
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;
  for (const r of sorted) {
    result += source.slice(cursor, r.start);
    result += r.replacement;
    cursor = r.end;
  }
  result += source.slice(cursor);
  return result;
}

/** Add `xmlns:xi` to the first root-like element that lacks it. */
export function ensureXIncludeNamespace(content: string): string {
  return content.replace(
    /<(pretext|book|article|chapter)\b([^>]*)>/,
    (whole, tag: string, attrs: string) => {
      if (/\bxmlns:xi\s*=/.test(attrs)) {
        return whole;
      }
      return `<${tag}${attrs} xmlns:xi="${XI_NAMESPACE}">`;
    },
  );
}

export function withProlog(content: string): string {
  if (content.startsWith('<?xml')) return content;
  return renderXmlProlog() + content;
}
