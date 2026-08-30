/**
 * The `vscode`-free half of paste-and-convert (SPEC §9.5).
 *
 * Deciding whether clipboard text is convertible, and fitting converted markup
 * to the place it is going, are both pure string problems. Keeping them out of
 * the provider module means they can be unit-tested directly, the way
 * `pure-utils.ts` is.
 */
import {
  PRETEXT_DIVISION_TAGS,
  detectSnippetFormat,
  scoreSnippetFormats,
} from "@pretextbook/import";

/** Source formats the snippet converter can take. */
export type ConvertibleSnippetFormat = "latex" | "markdown";

/**
 * Which converter, if any, this clipboard text warrants.
 *
 * `detectSnippetFormat` rather than `detectSourceFormat`: the latter answers
 * "is this file a LaTeX document?" using document furniture (`\documentclass`,
 * `\section`) that a pasted fragment never contains — it reports "pretext" for
 * `Let $G$ be a \emph{group}` and the paste goes through unconverted. The
 * snippet detector scores the grain of the markup instead, and declines when
 * unsure, so an ordinary paste of prose is untouched.
 */
export function detectConvertibleFormat(
  text: string,
): ConvertibleSnippetFormat | undefined {
  return detectSnippetFormat(text);
}

/** Why a snippet was or was not offered for conversion — for the log. */
export function describeDetection(text: string): string {
  const { latex, markdown } = scoreSnippetFormats(text.trim());
  const verdict = detectSnippetFormat(text) ?? "none";
  return `latex=${latex} markdown=${markdown} -> ${verdict}`;
}

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
  /** Something the author should know about — logged by the caller. */
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
