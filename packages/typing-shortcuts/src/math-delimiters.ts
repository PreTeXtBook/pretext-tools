/**
 * LaTeX-style math delimiters become PreTeXt markup as the author types:
 * `$math$` → `<m>math</m>`, `$$math$$` → `<md>math</md>`, the moment the
 * closing `$` lands.
 *
 * Ported from pretext-plus's `mathAutoConvert.ts`. Matching is deliberately
 * narrow: only within the same line and the same XML text node (never
 * spanning a tag boundary), never inside markup, a comment/CDATA block, or an
 * element whose content is verbatim or already math, and never when the
 * closing delimiter is preceded by whitespace (that shape is far more likely
 * to be an unrelated `$…` starting, e.g. "$5 or $10", than the end of real
 * math).
 */
import { MATH_ELEMENTS, VERBATIM_ELEMENTS } from "./elements";
import { lineEndOf, lineStartOf } from "./text";
import type { ShortcutEdit } from "./types";
import { isWithin, scanXmlContext } from "./xml-context";

const NO_DELIMITER_ELEMENTS: ReadonlySet<string> = new Set([
  ...MATH_ELEMENTS,
  ...VERBATIM_ELEMENTS,
]);

export interface LineMathMatch {
  /** 1-based, inclusive — start of the opening delimiter. */
  startColumn: number;
  /** 1-based, exclusive — equal to `column`, just past the typed `$`. */
  endColumn: number;
  replacement: string;
}

/**
 * Finds the `$...$` / `$$...$$` span that a `$` just typed at `column`
 * (1-based — the position immediately after the new character) closes, if
 * any. Pure, single-line string logic: the search never looks past the
 * nearest earlier `>` on the line, which is what keeps a match from spanning
 * two XML text nodes (e.g. `<p>a</p> $x$` can only match `$x$`).
 */
export const findLineMathMatch = (
  lineText: string,
  column: number,
): LineMathMatch | null => {
  const dollarIdx = column - 2;
  if (dollarIdx < 0 || lineText[dollarIdx] !== "$") return null;

  const boundary = lineText.lastIndexOf(">", dollarIdx - 1);
  const searchStart = boundary === -1 ? 0 : boundary + 1;

  const closesDisplay =
    dollarIdx - 1 >= searchStart && lineText[dollarIdx - 1] === "$";

  if (closesDisplay) {
    const closerStart = dollarIdx - 1;
    if (closerStart - 2 < searchStart) return null;
    const openIdx = lineText.lastIndexOf("$$", closerStart - 2);
    if (openIdx === -1 || openIdx < searchStart) return null;
    if (
      openIdx > searchStart &&
      (lineText[openIdx - 1] === "$" || lineText[openIdx - 1] === "\\")
    ) {
      return null;
    }
    const content = lineText.slice(openIdx + 2, closerStart);
    if (content.length === 0 || /\s$/.test(content)) return null;
    return {
      startColumn: openIdx + 1,
      endColumn: column,
      replacement: `<md>${content}</md>`,
    };
  }

  const closerIdx = dollarIdx;
  let openIdx = -1;
  for (let i = closerIdx - 1; i >= searchStart; i--) {
    if (lineText[i] === "$") {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) return null;
  // A '$' immediately preceded by another '$' is an unresolved `$$` run —
  // ambiguous, so bail rather than guess.
  if (openIdx > searchStart && lineText[openIdx - 1] === "$") return null;
  if (openIdx > searchStart && lineText[openIdx - 1] === "\\") return null;
  const content = lineText.slice(openIdx + 1, closerIdx);
  if (content.length === 0 || /\s$/.test(content)) return null;
  return {
    startColumn: openIdx + 1,
    endColumn: column,
    replacement: `<m>${content}</m>`,
  };
};

/**
 * Whether a `$` at `offset` could be a math delimiter: it sits in ordinary
 * text, outside any math or verbatim element.
 */
export const isMathDelimiterContext = (
  source: string,
  offset: number,
): boolean => {
  const context = scanXmlContext(source, offset);
  return context.inText && !isWithin(context, NO_DELIMITER_ELEMENTS);
};

/** The conversion a `$` just typed at `dollarOffset` completes, if any. */
export const mathDelimiterEdit = (
  source: string,
  dollarOffset: number,
): ShortcutEdit | null => {
  const lineStart = lineStartOf(source, dollarOffset);
  const lineText = source.slice(lineStart, lineEndOf(source, dollarOffset));
  const match = findLineMathMatch(lineText, dollarOffset - lineStart + 2);
  if (!match || !isMathDelimiterContext(source, dollarOffset)) return null;
  const start = lineStart + match.startColumn - 1;
  return {
    kind: "math",
    start,
    end: dollarOffset + 1,
    text: match.replacement,
    caret: start + match.replacement.length,
  };
};
