/**
 * Moving on from an empty paragraph — the Enter after the one that split a
 * paragraph, or Shift+Enter in an empty `<p>`:
 *
 * - in a list item with content before it, the empty `<p>` becomes the
 *   paragraph of a new item;
 * - in an empty list item (or one holding only the empty `<p>`) at the end
 *   of its list, the item goes and the caret lands after the list, inside the
 *   paragraph that holds it;
 * - at the end of any other block (a `<statement>`, `<proof>`, `<solution>`,
 *   …), the empty `<p>` goes and the caret lands on a line of its own just
 *   after the block's end tag, for the author to start whatever comes next.
 *
 * Divisions are left alone: an empty paragraph at the end of a section is
 * just an empty paragraph.
 */
import {
  DIVISION_ELEMENTS,
  LIST_ELEMENTS,
  NON_BLOCK_ELEMENTS,
} from "./elements";
import { eolOf, indentationAt, isInlineSpace, isWhitespace } from "./text";
import type { ShortcutEdit } from "./types";
import {
  findEndTag,
  findTagEnd,
  scanXmlContext,
  type OpenElement,
} from "./xml-context";

/** `from`, moved back over whitespace but not past `floor`. */
const trimBack = (source: string, from: number, floor: number): number => {
  let at = from;
  while (at > floor && isWhitespace(source[at - 1])) at--;
  return at;
};

const isLineBreak = (ch: string | undefined): boolean =>
  ch === "\n" || ch === "\r";

/** Whether `element`'s content starts on a line after its start tag. */
const isBlock = (source: string, element: OpenElement): boolean => {
  let first = element.end;
  while (isWhitespace(source[first])) first++;
  return /[\r\n]/.test(source.slice(element.end, first));
};

/**
 * The edit that moves on from the empty `<p>` (or empty `<li>`) the caret at
 * `offset` is in, or `null` when there is nothing to move on to.
 */
export const nextBlockEdit = (
  source: string,
  offset: number,
  eol: string = eolOf(source),
): ShortcutEdit | null => {
  const context = scanXmlContext(source, offset);
  if (!context.inText) return null;
  const { open } = context;
  const host = open[open.length - 1];
  if (host?.name !== "p" && host?.name !== "li") return null;
  const close = findEndTag(source, offset, host.name);
  if (close === -1 || source.slice(host.end, close).trim() !== "") return null;

  if (host.name === "li")
    return leaveListEdit(source, open, open.length - 1, eol);

  const pEnd = findTagEnd(source, close);
  const container = open[open.length - 2];
  if (!container) return null;
  if (container.name === "li") {
    if (source.slice(container.end, host.start).trim()) {
      return nextItemEdit(source, container, host, pEnd, eol);
    }
    const itemClose = findEndTag(source, pEnd, "li");
    if (itemClose === -1 || source.slice(pEnd, itemClose).trim()) return null;
    return leaveListEdit(source, open, open.length - 2, eol);
  }
  return stepOutEdit(source, container, open[open.length - 3], host, pEnd, eol);
};

/**
 * End list item `li` before the empty paragraph `p` and start the next item
 * with it: `<li><p>…</p></li><li><p>|</p></li>`. Anything after `p` in the
 * item moves to the new one. The item and its paragraph follow the layout of
 * the item and of its first paragraph.
 */
const nextItemEdit = (
  source: string,
  li: OpenElement,
  p: OpenElement,
  pEnd: number,
  eol: string,
): ShortcutEdit => {
  const start = trimBack(source, p.start, li.end);
  let end = pEnd;
  while (isWhitespace(source[end])) end++;
  const endsItem = /^<\/li\s*>/.test(source.slice(end, end + 8));

  let open = "<p>";
  let close = "</p>";
  // The item's first paragraph sets the layout: a later `<p>` before this one
  // may sit in a nested list.
  const prior = /<p(?=[\s>])/.exec(source.slice(li.end, start));
  if (prior) {
    const priorStart = li.end + prior.index;
    const priorEnd = findTagEnd(source, priorStart);
    let first = priorEnd;
    while (isWhitespace(source[first])) first++;
    if (/[\r\n]/.test(source.slice(priorEnd, first))) {
      open = `<p>${eol}${indentationAt(source, first)}`;
      close = `${eol}${indentationAt(source, priorStart)}</p>`;
    }
  }

  const indent = indentationAt(source, li.start);
  let head: string;
  let tail = "";
  if (isBlock(source, li)) {
    let first = li.end;
    while (isWhitespace(source[first])) first++;
    const inner = indentationAt(source, first);
    head = `${eol}${indent}</li>${eol}${indent}<li>${eol}${inner}`;
    tail = eol + (endsItem ? indent : inner);
  } else {
    head = `</li>${eol}${indent}<li>`;
  }
  return {
    kind: "paragraph",
    start,
    end,
    text: head + open + close + tail,
    caret: start + head.length + open.length,
  };
};

/**
 * Drop the empty last item `open[index]` of its list and put the caret on a
 * line of its own after the list, still inside whatever holds the list
 * (PreTeXt lists live in paragraphs). A list left with no items goes too.
 * `null` when the item isn't the list's last.
 */
const leaveListEdit = (
  source: string,
  open: OpenElement[],
  index: number,
  eol: string,
): ShortcutEdit | null => {
  const li = open[index];
  const list = open[index - 1];
  if (!list || !LIST_ELEMENTS.has(list.name)) return null;
  const itemClose = findEndTag(source, li.end, "li");
  if (itemClose === -1) return null;
  const itemEnd = findTagEnd(source, itemClose);
  const listClose = findEndTag(source, itemEnd, list.name);
  if (listClose === -1 || source.slice(itemEnd, listClose).trim()) return null;
  const listEnd = findTagEnd(source, listClose);
  const holder = open[index - 2];

  let start: number;
  let text: string;
  if (source.slice(list.end, li.start).trim()) {
    start = trimBack(source, li.start, list.end);
    text = source.slice(itemEnd, listEnd);
  } else {
    start = trimBack(source, list.start, holder?.end ?? 0);
    text = "";
  }
  text += eol + indentationAt(source, list.start);
  const caret = start + text.length;

  let end = listEnd;
  while (isInlineSpace(source[end])) end++;
  if (source.startsWith("</", end)) {
    text += eol + (holder ? indentationAt(source, holder.start) : "");
  }
  return { kind: "paragraph", start, end, text, caret };
};

/**
 * Drop the empty paragraph `p` that ends `container` and put the caret on a
 * line of its own after the container's end tag. `null` for divisions and
 * lists, when `p` isn't the container's last child, or when nothing precedes
 * it — a `<statement>` is never left empty.
 */
const stepOutEdit = (
  source: string,
  container: OpenElement,
  parent: OpenElement | undefined,
  p: OpenElement,
  pEnd: number,
  eol: string,
): ShortcutEdit | null => {
  const { name } = container;
  if (
    DIVISION_ELEMENTS.has(name) ||
    NON_BLOCK_ELEMENTS.has(name) ||
    LIST_ELEMENTS.has(name)
  ) {
    return null;
  }
  const close = findEndTag(source, pEnd, name);
  if (close === -1 || source.slice(pEnd, close).trim()) return null;
  const start = trimBack(source, p.start, container.end);
  if (start === container.end) return null;
  const closeEnd = findTagEnd(source, close);

  const indent = indentationAt(source, container.start);
  let text =
    (isBlock(source, container) ? eol + indent : "") +
    source.slice(close, closeEnd) +
    eol +
    indent;
  const caret = start + text.length;

  let end = closeEnd;
  while (isInlineSpace(source[end])) end++;
  if (end < source.length && !isLineBreak(source[end])) {
    text +=
      eol +
      (source.startsWith("</", end)
        ? parent
          ? indentationAt(source, parent.start)
          : ""
        : indent);
  }
  return { kind: "paragraph", start, end, text, caret };
};
