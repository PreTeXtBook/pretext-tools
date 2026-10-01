/**
 * Plain-text typography becomes PreTeXt's character elements on the space
 * typed after it: `--` → `<ndash/>`, `---` → `<mdash/>`, `...` →
 * `<ellipsis/>`.
 *
 * Waiting for the space keeps `---` from being caught as `--`, and leaves
 * runs that aren't followed by one (`1--3`, `--verbose`, `etc...)`) alone.
 * Runs of any other length are left alone too.
 */
import { isMarkupContext } from "./inline-markup";
import { insideOpenSpan, textRun } from "./text-run";
import { lineStartOf } from "./text";
import type { ShortcutEdit } from "./types";

const REPLACEMENTS: Record<string, string> = {
  "--": "<ndash/>",
  "---": "<mdash/>",
  "...": "<ellipsis/>",
};

/** The character element completed by whitespace just typed at `offset`, if any. */
export const typographyEdit = (
  source: string,
  offset: number,
): ShortcutEdit | null => {
  const lineStart = lineStartOf(source, offset);
  const { text, start } = textRun(source.slice(lineStart, offset));
  const ch = text[text.length - 1];
  if (ch !== "-" && ch !== ".") return null;
  let from = text.length;
  while (from > start && text[from - 1] === ch) from--;
  const replacement = REPLACEMENTS[text.slice(from)];
  if (!replacement) return null;
  if (insideOpenSpan(text, start, from)) return null;
  if (!isMarkupContext(source, offset)) return null;
  const run = text.length - from;
  return {
    kind: "typography",
    start: lineStart + from,
    end: offset,
    text: replacement,
    caret: offset + 1 + replacement.length - run,
  };
};
