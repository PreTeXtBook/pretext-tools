/**
 * Offset-based line helpers. Everything in this package works on the whole
 * document as one string plus offsets into it — the one coordinate system
 * VS Code and Monaco share — and these helpers recover line structure from
 * that, treating `\r\n` and `\n` alike.
 */

/** A space or a tab. */
export const isInlineSpace = (ch: string | undefined): boolean =>
  ch === " " || ch === "\t";

/** A space, tab, or line break. */
export const isWhitespace = (ch: string | undefined): boolean =>
  ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

/** Offset of the first character on the line containing `offset`. */
export const lineStartOf = (source: string, offset: number): number =>
  source.lastIndexOf("\n", offset - 1) + 1;

/** Offset just past the last character (before any `\r\n`/`\n`) on the line containing `offset`. */
export const lineEndOf = (source: string, offset: number): number => {
  let end = source.indexOf("\n", offset);
  if (end === -1) return source.length;
  if (end > 0 && source[end - 1] === "\r") end--;
  return end;
};

/** The leading spaces and tabs of the line containing `offset`. */
export const indentationAt = (source: string, offset: number): string => {
  const start = lineStartOf(source, offset);
  let end = start;
  while (isInlineSpace(source[end])) end++;
  return source.slice(start, end);
};

/** The line break the document already uses, so inserted text matches it. */
export const eolOf = (source: string): string =>
  source.includes("\r\n") ? "\r\n" : "\n";
