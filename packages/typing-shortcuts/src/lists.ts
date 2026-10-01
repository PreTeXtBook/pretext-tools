/**
 * Markdown-style list markers start PreTeXt lists, on the space typed after
 * the marker at the start of a line:
 *
 * - inside a `<p>`, `- ` or `* ` starts a `<ul>` and `1. ` an `<ol>` (`a.`,
 *   `(i)`, `A)`, … set its `marker`), with the caret in its first `<li>`;
 * - inside an `<li>`, any marker ends that item and starts the next one —
 *   as does a marker in an empty `<p>` that ends an item, so items with
 *   several paragraphs can carry on too.
 *
 * "The start of a line" means nothing but indentation before the marker on
 * its line, or nothing at all between it and the start tag of the element
 * it's in.
 */
import { splitElementEdit } from "./paragraphs";
import {
  eolOf,
  indentationAt,
  isInlineSpace,
  lineEndOf,
  lineStartOf,
} from "./text";
import type { ShortcutEdit } from "./types";
import { scanXmlContext, type OpenElement } from "./xml-context";

/**
 * Indentation, then a bullet (`-`, `*`), a number or `a`/`A`/`i`/`I` with `.`
 * or `)` after it, or one in parentheses.
 */
const MARKER =
  /^([ \t]*)(?:([-*])|(\d{1,2}|[aAiI])([.)])|\((\d{1,2}|[aAiI])\))$/;

/** The `marker` attribute an `<ol>` started by `match` needs, if any. */
const orderedMarker = (match: RegExpExecArray): string => {
  const label = match[3] ?? match[5];
  const style = /\d/.test(label) ? "1" : label;
  const marker = match[5] ? `(${style})` : `${style}${match[4]}`;
  return marker === "1." ? "" : ` marker="${marker}"`;
};

/**
 * The list edit completed by a space just typed at `offset`, if the line up
 * to it holds only a list marker.
 */
export const listMarkerEdit = (
  source: string,
  offset: number,
  indentUnit: string,
  eol: string = eolOf(source),
): ShortcutEdit | null => {
  const context = scanXmlContext(source, offset);
  const host = context.open[context.open.length - 1];
  if (!context.inText || (host?.name !== "p" && host?.name !== "li")) {
    return null;
  }
  const lineStart = lineStartOf(source, offset);
  const segmentStart = Math.max(lineStart, host.end);
  const match = MARKER.exec(source.slice(segmentStart, offset));
  if (!match) return null;
  const markerStart = segmentStart + match[1].length;
  const caret = offset + 1;

  if (host.name === "li") {
    return splitElementEdit(source, host, markerStart, caret, eol, "list");
  }

  const parent = context.open[context.open.length - 2];
  if (
    parent?.name === "li" &&
    source.slice(host.end, markerStart).trim() === ""
  ) {
    const close = /^\s*<\/p\s*>/.exec(source.slice(caret));
    const edit =
      close &&
      splitElementEdit(
        source,
        parent,
        host.start,
        caret + close[0].length,
        eol,
        "list",
      );
    if (edit) return edit;
  }

  return startListEdit(
    source,
    host,
    match,
    segmentStart,
    caret,
    indentUnit,
    eol,
  );
};

/** A new list in paragraph `p`, replacing the marker `match` found at `segmentStart`. */
const startListEdit = (
  source: string,
  p: OpenElement,
  match: RegExpExecArray,
  segmentStart: number,
  caret: number,
  indentUnit: string,
  eol: string,
): ShortcutEdit => {
  const tag = match[2] ? "ul" : "ol";
  const attributes = match[2] ? "" : orderedMarker(match);
  const pIndent = indentationAt(source, p.start);

  // On a line of its own the list takes the marker's place; right after
  // `<p>` it starts on the next line.
  let start: number;
  let indent: string;
  let lead = "";
  if (segmentStart !== p.end) {
    start = segmentStart + match[1].length;
    indent = match[1];
  } else {
    start = p.end;
    indent = pIndent + indentUnit;
    lead = eol + indent;
  }

  // Plain text after the marker becomes the item; markup (the paragraph's
  // `</p>`, say) moves to the line after the list.
  const lineEnd = lineEndOf(source, caret);
  const rest = source.slice(caret, lineEnd);
  let end = lineEnd;
  let content = rest.trim();
  let after = "";
  if (rest.includes("<")) {
    content = "";
    end = caret;
    while (isInlineSpace(source[end])) end++;
    after = eol + (source.startsWith("</", end) ? pIndent : indent);
  }

  const head = `${lead}<${tag}${attributes}>${eol}${indent}${indentUnit}<li>`;
  return {
    kind: "list",
    start,
    end,
    text: `${head}${content}</li>${eol}${indent}</${tag}>${after}`,
    caret: start + head.length,
  };
};
