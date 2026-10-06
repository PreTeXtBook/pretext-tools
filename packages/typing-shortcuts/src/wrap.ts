/**
 * Wrapping a selection in an element:
 *
 * - `$`, `*`, `` ` `` or `"` typed over a selection wraps it in `<m>`,
 *   `<em>`, `<c>` or `<q>`, the elements the Markdown-style shortcuts make;
 * - `<` typed over a selection wraps it in an element named by typing, into
 *   both tags at once, with the element completions open;
 * - {@link wrapSelectionEdit} wraps it in any element by name, for a host's
 *   "wrap selection" command.
 *
 * The typed characters arrive through the editor's own auto-surround (the
 * language configuration's `surroundingPairs`), which puts the character
 * before the selection and its partner after it in one change event. So all
 * the session sees is `$text$`, which it rewrites like any other shortcut,
 * as an undo step of its own.
 *
 * An element's template is its completion snippet (`ELEMENTS` in
 * `@pretextbook/completions`), with `$TM_SELECTED_TEXT` marking where the
 * selection goes; making another element wrap its own way is a matter of
 * adding that variable to its snippet. Any other element gets a plain
 * `<name>…</name>`: on one line around a selection within a line, on lines
 * of their own around one that spans lines. Either way the selection stays
 * selected inside its new element (as a snippet placeholder), so wrappers
 * stack.
 */
import { ELEMENTS } from "@pretextbook/completions";
import { isMarkupContext } from "./inline-markup";
import { escapeSnippetText } from "./snippets";
import { indentationAt, isWhitespace, lineStartOf } from "./text";
import type { EditorState, ShortcutEdit } from "./types";
import { scanXmlContext, type XmlContext } from "./xml-context";

/**
 * What typing each character over a selection wraps it in, and the partner
 * the editor's auto-surround puts after the selection. `null`: an element the
 * author names by typing.
 */
export const SURROUND_WRAPPERS: ReadonlyMap<
  string,
  { close: string; element: string | null }
> = new Map<string, { close: string; element: string | null }>([
  ["$", { close: "$", element: "m" }],
  ["*", { close: "*", element: "em" }],
  ["`", { close: "`", element: "c" }],
  ['"', { close: '"', element: "q" }],
  ["<", { close: ">", element: null }],
]);

const ELEMENT_NAME = /^[A-Za-z_][\w.:-]*$/;

/** Where a snippet takes the selection: `${1:$TM_SELECTED_TEXT}`, or the bare variable. */
const SLOT =
  /\$\{(\d+):\$TM_SELECTED_TEXT\}|\$\{TM_SELECTED_TEXT\}|\$TM_SELECTED_TEXT\b/;

/**
 * The end tag of an element named by typing: a mirror of the start tag's
 * name, less any attributes typed after it (the transform applies when the
 * author tabs on).
 */
const MIRRORED_END_TAG = "</${1/[\\s>].*//}>";

/** The leading spaces and tabs of `text`. */
const leadingWhitespace = (text: string): string => /^[ \t]*/.exec(text)![0];

const commonPrefix = (a: string, b: string): string => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
};

/** Tab stops in `template` numbered one up (`$0` stays), to make room for a new `$1`. */
export const shiftTabStops = (template: string): string =>
  template.replace(/(?<!\\)\$(\{?)(\d+)/g, (stop, brace: string, n: string) =>
    n === "0" ? stop : "$" + brace + (Number(n) + 1),
  );

/**
 * `name`'s completion snippet, if it marks where a selection goes, less
 * anything after its last tag: a wrapper ends where the selection did.
 */
const snippetTemplate = (name: string): string | undefined => {
  const body = ELEMENTS[name]?.insertText;
  if (typeof body !== "string" || !SLOT.test(body)) return undefined;
  return body.replace(/\s*(\$0)?\s*$/, (_, zero?: string) => zero ?? "");
};

/** `<name>…</name>`, or for `null`, an element named by typing. */
const genericTemplate = (name: string | null, block: boolean): string => {
  const open = name === null ? "<$1>" : `<${name}>`;
  const close = name === null ? MIRRORED_END_TAG : `</${name}>`;
  const slot = `\${${name === null ? 2 : 1}:$TM_SELECTED_TEXT}`;
  return block ? `${open}\n\t${slot}\n${close}$0` : `${open}${slot}${close}$0`;
};

/**
 * Whether `start`–`end` starts and ends in text inside the same element, so
 * that wrapping it keeps the markup well formed.
 */
export const isWrappable = (
  source: string,
  start: number,
  end: number,
): boolean => {
  const before = scanXmlContext(source, start);
  const after = scanXmlContext(source, end);
  return (
    before.inText &&
    after.inText &&
    before.open.length === after.open.length &&
    before.open.every((element, i) => element.start === after.open[i].start)
  );
};

/**
 * The edit wrapping `start`–`end` of `source` in `element` (for `null`, in an
 * element named by typing, with the completions to open), or `null` if the
 * selection can't be wrapped (see {@link isWrappable}) or `element` isn't an
 * element name.
 *
 * The edit replaces exactly `start`–`end`, keeping whitespace at either end
 * of the selection outside the element. Its lines are indented as they are
 * to end up (`keepWhitespace`): the wrapper's under the line it starts on, the
 * selection's one level further in, keeping their indentation relative to
 * each other.
 */
export const wrapSelectionEdit = (
  source: string,
  start: number,
  end: number,
  element: string | null,
  state: EditorState = {},
): ShortcutEdit | null => {
  if (element !== null && !ELEMENT_NAME.test(element)) return null;
  if (!isWrappable(source, start, end)) return null;

  let from = start;
  let to = end;
  while (from < to && isWhitespace(source[from])) from++;
  while (to > from && isWhitespace(source[to - 1])) to--;

  // The selected lines, indented relative to the first.
  const lines = source.slice(from, to).split(/\r?\n/);
  let base = indentationAt(source, from);
  for (const line of lines.slice(1)) {
    if (/\S/.test(line)) base = commonPrefix(base, leadingWhitespace(line));
  }
  const content = lines.map((line, i) =>
    i === 0 ? line : /\S/.test(line) ? line.slice(base.length) : "",
  );

  let template =
    (element !== null && snippetTemplate(element)) ||
    genericTemplate(element, lines.length > 1);
  const { indentUnit } = state;
  if (indentUnit) {
    template = template.replace(/^\t+/gm, (tabs) =>
      indentUnit.repeat(tabs.length),
    );
  }
  let slot = SLOT.exec(template)!;
  if (slot[1] === undefined) {
    // A bare `$TM_SELECTED_TEXT` becomes the first placeholder.
    template = shiftTabStops(template);
    slot = SLOT.exec(template)!;
  }
  const before = template.slice(0, slot.index);
  const after = template.slice(slot.index + slot[0].length);
  const stop = slot[1] ?? "1";

  const slotIndent = leadingWhitespace(
    before.slice(before.lastIndexOf("\n") + 1),
  );
  const selected = content
    .map((line, i) =>
      escapeSnippetText(i > 0 && line ? slotIndent + line : line),
    )
    .join("\n");
  const wrapper =
    before +
    (selected ? "${" + stop + ":" + selected + "}" : "$" + stop) +
    after;

  const wrapperIndent = leadingWhitespace(
    source.slice(lineStartOf(source, from), from),
  );
  const text =
    source.slice(start, from) +
    wrapper.replace(/\n(?=[^\n])/g, "\n" + wrapperIndent) +
    source.slice(to, end);

  return {
    kind: "wrap",
    start,
    end,
    text,
    snippet: true,
    keepWhitespace: true,
    ...(element === null && { suggest: true }),
  };
};

/**
 * What a surround becomes where it can't become an element: inside math or
 * verbatim code, in an attribute value, or around a selection that crosses
 * element boundaries. `source` is the document with the surround in it,
 * `open` the character typed, `start`–`end` the surround (both characters
 * included), and `context` where it starts. Return the edit to apply, or
 * `null` to leave the editor's surround (`$x$`, `<x>`, …) as it is.
 */
export const surroundFallback = (
  source: string,
  open: string,
  start: number,
  end: number,
  context: XmlContext,
): ShortcutEdit | null => {
  // TODO: decide what each surround character does outside markup.
  return null;
};

/**
 * The edit for a selection the editor has just surrounded with `open` and
 * `close`, which now sit at `start` and `end - 1` of `source`: the element
 * the pair stands for in {@link SURROUND_WRAPPERS}, or else whatever
 * {@link surroundFallback} decides. `null` for any other pair.
 */
export const surroundEdit = (
  source: string,
  open: string,
  close: string,
  start: number,
  end: number,
  state: EditorState = {},
): ShortcutEdit | null => {
  const wrapper = SURROUND_WRAPPERS.get(open);
  if (!wrapper || wrapper.close !== close) return null;
  // The document as it was before the surround.
  const original =
    source.slice(0, start) +
    source.slice(start + 1, end - 1) +
    source.slice(end);
  const edit = isMarkupContext(original, start)
    ? wrapSelectionEdit(original, start, end - 2, wrapper.element, state)
    : null;
  // The wrap replaces exactly the selection, so here it also takes the
  // characters on either side.
  return edit
    ? { ...edit, end: edit.end + 2 }
    : surroundFallback(source, open, start, end, scanXmlContext(source, start));
};
