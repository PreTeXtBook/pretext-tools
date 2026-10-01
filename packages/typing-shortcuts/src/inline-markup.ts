/**
 * Markdown-style inline markup becomes PreTeXt markup as the author types:
 *
 * - `*text*` → `<em>`, `**text**` → `<alert>` and `` `text` `` → `<c>`, the
 *   moment the closing delimiter lands;
 * - `_text_` → `<term>` and `"text"` → `<q>` on the space typed after the
 *   closing delimiter (punctuation may come between), since `_` and `"` turn
 *   up in ordinary prose far more often;
 * - `[text](url)` → `<url href="url">text</url>` on the `)`;
 * - `@` after a space → `<xref ref=""/>`, with the id completions open.
 *
 * Pairing follows the same narrow rules as the math delimiters (one line, one
 * text node — see {@link textRun}) plus CommonMark's flanking rules: the
 * opening delimiter can't follow a letter or digit (`2*3*4`, `snake_case_`),
 * and the content can't start or end with whitespace (`* item`). Inside a
 * code or math span that is still open, nothing converts.
 */
import { MATH_ELEMENTS, VERBATIM_ELEMENTS } from "./elements";
import { insideOpenSpan, MASK, textRun } from "./text-run";
import { isWhitespace, lineStartOf } from "./text";
import type { ShortcutEdit } from "./types";
import { isWithin, scanXmlContext } from "./xml-context";

const NO_MARKUP_ELEMENTS: ReadonlySet<string> = new Set([
  ...MATH_ELEMENTS,
  ...VERBATIM_ELEMENTS,
]);

const WORD = /[\p{L}\p{N}]/u;

/** Characters that may sit between `_term_`/`"quote"` and the space after it. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]]/;

/** Characters an opening `_`/`"` (or an `@`) may follow, besides whitespace. */
const OPENING_PUNCTUATION = /[([]/;

/** Whether markup may be written at `offset`: in text, outside math and code. */
export const isMarkupContext = (source: string, offset: number): boolean => {
  const context = scanXmlContext(source, offset);
  return context.inText && !isWithin(context, NO_MARKUP_ELEMENTS);
};

/** Content a delimiter pair may wrap: something, not padded with whitespace. */
const isTight = (content: string): boolean =>
  content.length > 0 &&
  !isWhitespace(content[0]) &&
  !isWhitespace(content[content.length - 1]);

/** Whether the opening delimiter at `index` follows something it may follow. */
const opensAfter = (text: string, start: number, index: number): boolean =>
  index === start ||
  isWhitespace(text[index - 1]) ||
  OPENING_PUNCTUATION.test(text[index - 1]);

/**
 * The current line up to `end` (exclusive), as a {@link textRun}, plus
 * where the line starts.
 */
const runBefore = (source: string, end: number) => {
  const lineStart = lineStartOf(source, end);
  const line = source.slice(lineStart, end);
  return { lineStart, line, ...textRun(line) };
};

/**
 * Replace `from`–`to` (indices into the line) with `text`, leaving the caret
 * where it was relative to the text after `to`.
 */
const replaceInLine = (
  lineStart: number,
  from: number,
  to: number,
  text: string,
  caret: number,
): ShortcutEdit => ({
  kind: "markup",
  start: lineStart + from,
  end: lineStart + to,
  text,
  caret: caret + text.length - (to - from),
});

/** The `<em>`/`<alert>` a `*` just typed at `offset` closes, if any. */
export const emphasisEdit = (
  source: string,
  offset: number,
): ShortcutEdit | null => {
  const { lineStart, line, text, start } = runBefore(source, offset + 1);
  const close = offset - lineStart;
  const double = close - 1 >= start && text[close - 1] === "*";
  // The first character of the closing delimiter, and of the content.
  const closer = double ? close - 1 : close;
  if (closer - 1 < start || text[closer - 1] === "*") return null;

  const inner = text.lastIndexOf("*", closer - 1);
  if (inner < start) return null;
  let opener = inner;
  if (double) {
    if (text[inner - 1] !== "*" || inner - 1 < start) return null;
    opener = inner - 1;
  }
  const before = opener > start ? text[opener - 1] : "";
  // An unresolved `**` (for `*`), a `***` run, an escape, or mid-word.
  if (before === "*" || before === "\\" || WORD.test(before)) return null;

  const content = line.slice(inner + 1, closer);
  if (!isTight(content)) return null;
  if (insideOpenSpan(text, start, opener)) return null;
  if (!isMarkupContext(source, offset)) return null;

  const tag = double ? "alert" : "em";
  return replaceInLine(
    lineStart,
    opener,
    close + 1,
    `<${tag}>${content}</${tag}>`,
    offset + 1,
  );
};

/** The `<c>` a backtick just typed at `offset` closes, if any. */
export const codeSpanEdit = (
  source: string,
  offset: number,
): ShortcutEdit | null => {
  const { lineStart, line, text, start } = runBefore(source, offset + 1);
  const close = offset - lineStart;
  const opener = text.lastIndexOf("`", close - 1);
  if (opener < start) return null;
  if (
    opener > start &&
    (text[opener - 1] === "`" || text[opener - 1] === "\\")
  ) {
    return null;
  }
  const content = line.slice(opener + 1, close);
  if (content.trim() === "" || text.slice(opener, close).includes(MASK)) {
    return null;
  }
  if (insideOpenSpan(text, start, opener)) return null;
  if (!isMarkupContext(source, offset)) return null;
  return replaceInLine(
    lineStart,
    opener,
    close + 1,
    `<c>${content}</c>`,
    offset + 1,
  );
};

const WRAPPED_BY: Record<string, string> = { _: "term", '"': "q" };

/**
 * The `<term>`/`<q>` completed by whitespace just typed at `offset`: the
 * line before it ends `_text_` or `"text"`, optionally followed by
 * punctuation, and the opening delimiter follows whitespace (or starts the
 * text).
 */
export const wrapBeforeWhitespaceEdit = (
  source: string,
  offset: number,
): ShortcutEdit | null => {
  const { lineStart, line, text, start } = runBefore(source, offset);
  let end = text.length;
  while (end > start && TRAILING_PUNCTUATION.test(text[end - 1])) end--;
  const close = end - 1;
  const delimiter = text[close];
  const tag = WRAPPED_BY[delimiter];
  if (!tag || close - 1 < start) return null;

  const opener = text.lastIndexOf(delimiter, close - 1);
  if (opener < start || !opensAfter(text, start, opener)) return null;
  const content = line.slice(opener + 1, close);
  if (!isTight(content)) return null;
  if (insideOpenSpan(text, start, opener)) return null;
  if (!isMarkupContext(source, offset)) return null;
  return replaceInLine(
    lineStart,
    opener,
    close + 1,
    `<${tag}>${content}</${tag}>`,
    offset + 1,
  );
};

/** `&` and `"` made safe for an attribute value; entities are left alone. */
const escapeAttribute = (value: string): string =>
  value
    .replace(/&(?![A-Za-z][\w.-]*;|#\d+;|#x[\da-fA-F]+;)/g, "&amp;")
    .replace(/"/g, "&quot;");

/** The `<url>` a `)` just typed at `offset` completes as `[text](url)`, if any. */
export const linkEdit = (
  source: string,
  offset: number,
): ShortcutEdit | null => {
  const { lineStart, line, text, start } = runBefore(source, offset + 1);
  const close = offset - lineStart;
  const paren = text.lastIndexOf("(", close - 1);
  if (paren - 1 <= start || text[paren - 1] !== "]") return null;
  const href = line.slice(paren + 1, close);
  if (!/^\S+$/.test(href) || href.includes(MASK)) return null;

  const bracket = text.lastIndexOf("[", paren - 2);
  if (bracket < start) return null;
  const label = line.slice(bracket + 1, paren - 1);
  // `![alt](src)` is a Markdown image, and a `]` means the brackets don't pair.
  if (text[bracket - 1] === "!" || label.includes("]")) return null;
  if (label.trim() !== label) return null;
  if (insideOpenSpan(text, start, bracket)) return null;
  if (!isMarkupContext(source, offset)) return null;

  const attribute = `href="${escapeAttribute(href)}"`;
  return replaceInLine(
    lineStart,
    bracket,
    close + 1,
    label ? `<url ${attribute}>${label}</url>` : `<url ${attribute}/>`,
    offset + 1,
  );
};

/**
 * The `<xref>` an `@` just typed at `offset` starts: a snippet with the caret
 * in its `ref`, asking the host to open the id completions. Only after
 * whitespace (or at the start of the text), so an email address is left
 * alone.
 */
export const xrefEdit = (
  source: string,
  offset: number,
): ShortcutEdit | null => {
  const { lineStart, text, start } = runBefore(source, offset);
  const at = offset - lineStart;
  if (!opensAfter(text, start, at)) return null;
  if (insideOpenSpan(text, start, at)) return null;
  if (!isMarkupContext(source, offset)) return null;
  return {
    kind: "xref",
    start: offset,
    end: offset + 1,
    text: '<xref ref="$1"/>$0',
    snippet: true,
    suggest: true,
  };
};
