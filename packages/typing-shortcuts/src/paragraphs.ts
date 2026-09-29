/**
 * Paragraph shortcuts: end the current `<p>` and start the next one, or start
 * a `<p>` where there isn't one.
 *
 * Both edits write out the indentation themselves (rather than going through
 * a snippet engine) and follow the layout the author is already using: a
 * paragraph whose content starts on the line after `<p>` is split into
 * paragraphs laid out the same way, and one written inline stays inline.
 */
import { NON_BLOCK_ELEMENTS } from "./elements";
import {
  eolOf,
  indentationAt,
  isInlineSpace,
  isWhitespace,
  lineEndOf,
  lineStartOf,
} from "./text";
import type { ShortcutEdit } from "./types";
import { innermost, isWithin, scanXmlContext } from "./xml-context";

const PARAGRAPH: ReadonlySet<string> = new Set(["p"]);

/**
 * Split the `<p>` that directly contains `offset` there: the text before
 * stays in this paragraph, the text after moves to a new one, and the caret
 * lands at the start of the new one. Whitespace around `offset` (including
 * the blank line a double Enter leaves) is absorbed.
 *
 * Returns `null` when `offset` isn't directly inside a `<p>` (inside `<m>` or
 * `<em>` within one, say), or when nothing precedes it in the paragraph.
 */
export const splitParagraphEdit = (
  source: string,
  offset: number,
  eol: string = eolOf(source),
): ShortcutEdit | null => {
  const context = scanXmlContext(source, offset);
  if (!context.inText || innermost(context) !== "p") return null;
  const p = context.open[context.open.length - 1];

  let before = offset;
  while (before > p.end && isWhitespace(source[before - 1])) before--;
  if (before === p.end) return null;
  let after = offset;
  while (after < source.length && isWhitespace(source[after])) after++;

  const pIndent = indentationAt(source, p.start);
  const endsParagraph = /^<\/p\s*>/.test(source.slice(after, after + 16));

  let firstContent = p.end;
  while (isWhitespace(source[firstContent])) firstContent++;
  const block = /[\r\n]/.test(source.slice(p.end, firstContent));

  let head: string;
  let tail = "";
  if (block) {
    const contentIndent = indentationAt(source, firstContent);
    head = `${eol}${pIndent}</p>${eol}${pIndent}<p>${eol}${contentIndent}`;
    if (endsParagraph) tail = eol + pIndent;
  } else {
    head = `</p>${eol}${pIndent}<p>`;
  }
  return {
    kind: "paragraph",
    start: before,
    end: after,
    text: head + tail,
    caret: before + head.length,
  };
};

/**
 * Start a new `<p>` at `offset`, which must be in text outside any paragraph.
 * On a blank line the paragraph fills that line; after other content on the
 * line it starts on the next one; content after the caret moves below it.
 *
 * Returns `null` inside a `<p>` (including markup within one) and in places a
 * paragraph can't go (see {@link NON_BLOCK_ELEMENTS}).
 */
export const insertParagraphEdit = (
  source: string,
  offset: number,
  indentUnit: string,
  eol: string = eolOf(source),
): ShortcutEdit | null => {
  const context = scanXmlContext(source, offset);
  if (
    !context.inText ||
    isWithin(context, PARAGRAPH) ||
    isWithin(context, NON_BLOCK_ELEMENTS)
  ) {
    return null;
  }

  const lineStart = lineStartOf(source, offset);
  const prefix = source.slice(lineStart, offset);
  const blankPrefix = prefix.trim() === "";
  let end = offset;
  const lineEnd = lineEndOf(source, offset);
  while (end < lineEnd && isInlineSpace(source[end])) end++;
  const blankSuffix = end === lineEnd;

  let indent: string;
  if (!blankPrefix || !blankSuffix) {
    indent = indentationAt(source, offset);
  } else if (prefix.length > 0) {
    indent = prefix;
  } else {
    // A blank line with no indentation yet: indent one level past the parent.
    const parent = context.open[context.open.length - 1];
    indent = parent ? indentationAt(source, parent.start) + indentUnit : "";
  }

  let start = offset;
  let lead: string;
  if (blankPrefix) {
    start = lineStart;
    lead = indent;
  } else {
    while (start > lineStart && isInlineSpace(source[start - 1])) start--;
    lead = eol + indent;
  }
  const head = `${lead}<p>${eol}${indent}${indentUnit}`;
  const tail = `${eol}${indent}</p>` + (blankSuffix ? "" : eol + indent);
  return {
    kind: "paragraph",
    start,
    end,
    text: head + tail,
    caret: start + head.length,
  };
};
