/**
 * The stretch of a line that a Markdown-style delimiter can pair within.
 *
 * Like the math delimiters, the inline-markup shortcuts never pair across a
 * tag boundary — but a *complete* inline element sitting in the text doesn't
 * count as one. `*for all $x$*` should still become `<em>`, even though by
 * the time the closing `*` is typed the math has already become `<m>x</m>`.
 * So complete elements (and self-closing tags) are masked out rather than
 * ending the run; any other tag ends it.
 */
import { findTagEnd, isNameStart, readName } from "./xml-context";

/** Stands in for each character of a masked-out element. */
export const MASK = "￼";

export interface TextRun {
  /**
   * The text it was given, with every complete element in the run replaced
   * character-for-character by {@link MASK}, so indices still line up.
   */
  text: string;
  /** Where the run starts: just past the nearest tag that ends it, else 0. */
  start: number;
}

/** The previous `<` before `index` (exclusive), or -1. */
const previousLt = (line: string, index: number): number =>
  index <= 0 ? -1 : line.lastIndexOf("<", index - 1);

/**
 * The start of the element whose end tag `</name>` begins at `closeLt`, if
 * that element starts on this line (nested elements of the same name are
 * matched up).
 */
const startTagOf = (line: string, closeLt: number, name: string): number => {
  if (!name) return -1;
  let depth = 0;
  for (
    let lt = previousLt(line, closeLt);
    lt !== -1;
    lt = previousLt(line, lt)
  ) {
    if (line[lt + 1] === "/") {
      if (readName(line, lt + 2) === name) depth++;
    } else if (
      readName(line, lt + 1) === name &&
      line[findTagEnd(line, lt) - 2] !== "/"
    ) {
      if (depth === 0) return lt;
      depth--;
    }
  }
  return -1;
};

/**
 * The text run that ends at the end of `prefix` — typically the current line
 * up to the caret.
 */
export const textRun = (prefix: string): TextRun => {
  const chars = prefix.split("");
  for (let i = prefix.length - 1; i >= 0; i--) {
    if (prefix[i] !== ">") continue;
    const lt = previousLt(prefix, i);
    let from = -1;
    if (lt !== -1) {
      if (prefix[i - 1] === "/" && isNameStart(prefix[lt + 1])) {
        from = lt;
      } else if (prefix[lt + 1] === "/") {
        from = startTagOf(prefix, lt, readName(prefix, lt + 2));
      }
    }
    if (from === -1) return { text: chars.join(""), start: i + 1 };
    for (let j = from; j <= i; j++) chars[j] = MASK;
    i = from;
  }
  return { text: chars.join(""), start: 0 };
};

/**
 * Whether `index` sits inside a code span or math span that is still being
 * typed: an odd number of backticks, or of (unescaped) `$`/`$$` runs, between
 * the start of the run and `index`. Markup delimiters there are code or
 * LaTeX, not markup.
 */
export const insideOpenSpan = (
  text: string,
  start: number,
  index: number,
): boolean => {
  let ticks = 0;
  let dollars = 0;
  for (let i = start; i < index; i++) {
    if (text[i] === "`") ticks++;
    else if (text[i] === "$" && text[i - 1] !== "$" && text[i - 1] !== "\\") {
      dollars++;
    }
  }
  return ticks % 2 === 1 || dollars % 2 === 1;
};
