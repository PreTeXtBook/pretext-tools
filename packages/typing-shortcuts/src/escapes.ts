/**
 * A bare `<`, `>` or `&` is escaped as the author types it: `&lt;`, `&gt;`,
 * `&amp;` in text, and `\lt`, `\gt` inside math (PreTeXt defines both macros
 * for every output format).
 *
 * The triggers follow the signal that makes each character unambiguous
 * (ported from pretext-plus's `angleBracketAutoConvert.ts` and
 * `ampersandAutoConvert.ts`):
 *
 * - `<` fires on the whitespace typed *after* it. A tag's `<` is always
 *   followed by a name character, `/`, `!` or `?`, never whitespace.
 * - `&` likewise: an entity reference never has whitespace after the `&`.
 * - `>` in text fires on the `>` itself when whitespace precedes it; the
 *   context check is what keeps a real tag's `>` (even `<p xml:id="x" >`)
 *   alone.
 * - Inside math both `<` and `>` wait for whitespace on *both* sides. A
 *   macro needs the trailing space (`\gt` followed by `y` would read as
 *   `\gty`), and requiring the leading one leaves LaTeX like `\left<` alone.
 */
import { MATH_ELEMENTS } from "./elements";
import { isWhitespace } from "./text";
import type { ShortcutEdit } from "./types";
import { innermost, scanXmlContext } from "./xml-context";

const precededByWhitespace = (source: string, offset: number): boolean =>
  offset === 0 || isWhitespace(source[offset - 1]);

/**
 * The escape completed by whitespace just typed at `typedStart`–`typedEnd`
 * (a space, a tab, or an Enter with its indentation), if the character before
 * it is a bare `<`, `&`, or (in math) `>`.
 *
 * `typedStart` is also where Monaco's auto-closed `<>` pair leaves a dangling
 * `>` when the author meant a bare `<`: typing a space between the two gives
 * `< >`, and that `>` is swept into the same edit. Only for a single typed
 * character — after an Enter, the `>` has moved on to the next line.
 */
export const escapeBeforeWhitespace = (
  source: string,
  typedStart: number,
  typedEnd: number,
): ShortcutEdit | null => {
  const at = typedStart - 1;
  const ch = source[at];
  if (ch !== "<" && ch !== "&" && ch !== ">") return null;

  const context = scanXmlContext(source, at);
  if (!context.inText) return null;
  const inMath = MATH_ELEMENTS.has(innermost(context) ?? "");

  let replacement: string;
  if (ch === "&") {
    replacement = "&amp;";
  } else if (inMath) {
    if (!precededByWhitespace(source, at)) return null;
    replacement = ch === "<" ? "\\lt" : "\\gt";
  } else if (ch === "<") {
    replacement = "&lt;";
  } else {
    // A `>` in text was already escaped when it was typed, if it was going to be.
    return null;
  }

  const typed = source.slice(typedStart, typedEnd);
  if (ch === "<" && typed.length === 1 && source[typedEnd] === ">") {
    const text = replacement + typed;
    return {
      kind: "escape",
      start: at,
      end: typedEnd + 1,
      text,
      caret: at + text.length,
    };
  }
  return {
    kind: "escape",
    start: at,
    end: at + 1,
    text: replacement,
    caret: typedEnd + replacement.length - 1,
  };
};

/** The escape of a `>` just typed at `offset` in text, after whitespace. */
export const escapeGreaterThan = (
  source: string,
  offset: number,
): ShortcutEdit | null => {
  if (offset === 0 || !isWhitespace(source[offset - 1])) return null;
  const context = scanXmlContext(source, offset);
  if (!context.inText || MATH_ELEMENTS.has(innermost(context) ?? "")) {
    return null;
  }
  return {
    kind: "escape",
    start: offset,
    end: offset + 1,
    text: "&gt;",
    caret: offset + 4,
  };
};
