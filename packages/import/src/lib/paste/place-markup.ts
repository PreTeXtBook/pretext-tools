/**
 * Fitting converted markup to the place it is going (SPEC §9.5).
 *
 * Conversion answers "what is this LaTeX in PreTeXt?"; this answers "and what
 * has to change for it to sit *here*?" — unwrapping a paragraph the insertion
 * point is already inside, matching the surrounding indentation, and saying so
 * when the two cannot be reconciled.
 *
 * Both questions are pure string problems, which is why they live here rather
 * than in a host: the VS Code paste provider and pretext-plus's Monaco binding
 * ask exactly the same one, and a second copy of these rules would drift from
 * the converters they follow.
 */
import { PRETEXT_DIVISION_TAGS } from "../pretext-divisions";

const P_TAG = /<(\/?)p(?=[\s>/])/g;

/**
 * Is `prefix` — the document text up to the insertion point — inside a `<p>`?
 *
 * Counted by walking the paragraph tags rather than parsing, because the
 * document is mid-edit and frequently not well-formed. Only the depth matters,
 * so a stray unclosed tag degrades to "treat it as block context", which is the
 * safer of the two guesses.
 */
export function isInlineContext(prefix: string): boolean {
  let depth = 0;
  P_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = P_TAG.exec(prefix)) !== null) {
    depth += match[1] ? -1 : 1;
  }
  return depth > 0;
}

const DIVISION_TAG_PATTERN = new RegExp(
  `<(${PRETEXT_DIVISION_TAGS.join("|")})(?=[\\s>/])`,
);

/** The first division element in `markup`, if it has one. */
export function firstDivisionTag(markup: string): string | undefined {
  return DIVISION_TAG_PATTERN.exec(markup)?.[1];
}

/**
 * Prepend baseIndent to every non-empty line of text.
 * When skipFirst is true (the insertion starts mid-line), the first line is
 * left as-is because the editor places it after the existing content there.
 */
export function reindentForContext(
  text: string,
  baseIndent: string,
  skipFirst: boolean,
): string {
  return text
    .split("\n")
    .map((line, i) =>
      i === 0 && skipFirst ? line : line ? baseIndent + line : line,
    )
    .join("\n");
}

export interface PlacementContext {
  /** The insertion point sits inside a `<p>`, so only inline content fits. */
  inline: boolean;
  /** Indentation of the line the insertion starts on. */
  baseIndent: string;
  /** The insertion starts partway along a line, after existing content. */
  midLine: boolean;
}

export interface PlacedMarkup {
  markup: string;
  /** Something the author should know about — reported by the caller. */
  warning?: string;
}

/**
 * Fit converted markup to where it is going.
 *
 * Two adjustments, both about context rather than conversion. Inside a
 * paragraph the converter's own wrapping `<p>` is one paragraph too many, so it
 * is unwrapped. A division landing inside a paragraph cannot be repaired here
 * at all — the honest thing is to insert it and say so, leaving the author to
 * move it, rather than silently emitting invalid markup or refusing a paste
 * they asked for.
 */
export function placeConvertedMarkup(
  converted: string,
  context: PlacementContext,
): PlacedMarkup {
  let markup = converted.trim();
  let warning: string | undefined;

  if (context.inline) {
    const unwrapped = markup.replace(/^<p>\s*([\s\S]*?)\s*<\/p>$/, "$1");
    markup = unwrapped !== markup ? unwrapped : markup.replace(/^<p>/, "");

    const division = firstDivisionTag(markup);
    if (division) {
      warning =
        `Pasted content produced a <${division}>, which cannot sit inside a <p>. ` +
        `It was inserted as-is — move it out of the paragraph to make the document valid.`;
    }
  }

  if (context.baseIndent) {
    markup = reindentForContext(markup, context.baseIndent, context.midLine);
  }

  return { markup, warning };
}
