/**
 * Paragraph shortcuts: end the current `<p>` and start the next one, start a
 * `<p>` where there isn't one, or give a list item a second paragraph.
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
import type { ShortcutEdit, ShortcutKind } from "./types";
import {
  findEndTag,
  innermost,
  isWithin,
  scanXmlContext,
  type OpenElement,
} from "./xml-context";

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
  return splitElementEdit(source, p, offset, offset, eol, "paragraph");
};

/**
 * Split `element` (a `<p>` or an `<li>`) at `from`–`to`, dropping whatever is
 * there (a list marker, say): what precedes stays in this element, what
 * follows moves to a new one of the same name, and the caret lands at the
 * start of the new one. Whitespace on either side is absorbed, and the
 * layout follows the element's — content on the line after the start tag
 * stays that way, inline content stays inline.
 *
 * Returns `null` when nothing precedes `from` in the element.
 */
export const splitElementEdit = (
  source: string,
  element: OpenElement,
  from: number,
  to: number,
  eol: string,
  kind: ShortcutKind,
): ShortcutEdit | null => {
  const { name } = element;
  let before = from;
  while (before > element.end && isWhitespace(source[before - 1])) before--;
  if (before === element.end) return null;
  let after = to;
  while (after < source.length && isWhitespace(source[after])) after++;

  const indent = indentationAt(source, element.start);
  const endsElement = new RegExp(`^</${name}\\s*>`).test(
    source.slice(after, after + name.length + 16),
  );

  let firstContent = element.end;
  while (isWhitespace(source[firstContent])) firstContent++;
  const block = /[\r\n]/.test(source.slice(element.end, firstContent));

  let head: string;
  let tail = "";
  if (block) {
    const contentIndent = indentationAt(source, firstContent);
    head = `${eol}${indent}</${name}>${eol}${indent}<${name}>${eol}${contentIndent}`;
    if (endsElement) tail = eol + indent;
  } else {
    head = `</${name}>${eol}${indent}<${name}>`;
  }
  return {
    kind,
    start: before,
    end: after,
    text: head + tail,
    caret: before + head.length,
  };
};

/**
 * Turn the text of the `<li>` that directly contains `offset` into two
 * paragraphs, split there — how a list item gets a second paragraph. Only
 * for an item that holds no `<p>` yet; one that does is split like any
 * paragraph.
 *
 * Returns `null` when `offset` isn't directly inside such an `<li>`, or when
 * nothing precedes it in the item.
 */
export const splitListItemEdit = (
  source: string,
  offset: number,
  indentUnit: string,
  eol: string = eolOf(source),
): ShortcutEdit | null => {
  const context = scanXmlContext(source, offset);
  if (!context.inText || innermost(context) !== "li") return null;
  const li = context.open[context.open.length - 1];
  const close = findEndTag(source, offset, "li");
  if (close === -1 || /<p[\s/>]/.test(source.slice(li.end, close))) {
    return null;
  }
  const first = source.slice(li.end, offset).trim();
  if (!first) return null;
  const second = source.slice(offset, close).trim();

  const indent = indentationAt(source, li.start);
  const inner = indent + indentUnit;
  const head = `${eol}${inner}<p>${first}</p>${eol}${inner}<p>`;
  return {
    kind: "paragraph",
    start: li.end,
    end: close,
    text: `${head}${second}</p>${eol}${indent}`,
    caret: li.end + head.length,
  };
};

/**
 * Start a new `<p>` at `offset`, which must be in text outside any paragraph.
 * On a blank line the paragraph fills that line; after other content on the
 * line it starts on the next one; content after the caret moves below it.
 *
 * Returns `null` inside a `<p>` (including markup within one) and in places a
 * paragraph can't go (see {@link NON_BLOCK_ELEMENTS}). An `<li>` holds
 * paragraphs even though its list sits in one, so only what is open inside
 * the innermost `<li>` counts.
 */
export const insertParagraphEdit = (
  source: string,
  offset: number,
  indentUnit: string,
  eol: string = eolOf(source),
): ShortcutEdit | null => {
  const context = scanXmlContext(source, offset);
  const item = context.open.map((element) => element.name).lastIndexOf("li");
  const local = { ...context, open: context.open.slice(item + 1) };
  if (
    !context.inText ||
    isWithin(local, PARAGRAPH) ||
    isWithin(local, NON_BLOCK_ELEMENTS)
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
