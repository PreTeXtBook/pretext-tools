/**
 * A Markdown code fence on a line of its own, then Enter, starts a code
 * block: ```` ```python ```` → `<program language="python">` with a `<code>`
 * element, a bare ```` ``` ```` → `<pre>`. Inside a paragraph, where neither
 * can go, a fence starts a code display, `<cd>`.
 *
 * No closing fence is needed: the snippet closes the element, with the caret
 * inside it.
 */
import { NON_BLOCK_ELEMENTS } from "./elements";
import { isWhitespace, lineEndOf, lineStartOf } from "./text";
import type { ShortcutEdit } from "./types";
import { innermost, isWithin, scanXmlContext } from "./xml-context";

const FENCE = /^([ \t]*)```([A-Za-z][\w+#.-]*)?[ \t]*$/;

const PARAGRAPH: ReadonlySet<string> = new Set(["p"]);

/** The code block snippet for a fence naming `language` (if any), at a block or in a `<p>`. */
export const codeBlockSnippet = (
  language: string | undefined,
  inParagraph: boolean,
): string => {
  if (inParagraph) return "<cd>\n\t$0\n</cd>";
  if (!language) return "<pre>\n\t$0\n</pre>";
  return `<program language="${language.toLowerCase()}">\n\t<code>\n\t\t$0\n\t</code>\n</program>`;
};

/**
 * The code block an Enter typed at `enterStart`–`enterEnd` starts, if the
 * line it was typed on holds nothing but a fence and the rest of that line is
 * blank. Replaces the fence and the Enter.
 */
export const codeBlockEdit = (
  source: string,
  enterStart: number,
  enterEnd: number,
): ShortcutEdit | null => {
  const lineStart = lineStartOf(source, enterStart);
  const match = FENCE.exec(source.slice(lineStart, enterStart));
  if (!match) return null;

  const end = lineEndOf(source, enterEnd);
  for (let i = enterEnd; i < end; i++) {
    if (!isWhitespace(source[i])) return null;
  }

  const start = lineStart + match[1].length;
  const context = scanXmlContext(source, start);
  if (!context.inText || isWithin(context, NON_BLOCK_ELEMENTS)) return null;
  const inParagraph = innermost(context) === "p";
  if (!inParagraph && isWithin(context, PARAGRAPH)) return null;

  return {
    kind: "code-block",
    start,
    end,
    text: codeBlockSnippet(match[2], inParagraph),
    snippet: true,
  };
};
