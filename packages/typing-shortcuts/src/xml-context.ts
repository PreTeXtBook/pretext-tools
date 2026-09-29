/**
 * Where an offset sits in PreTeXt source that is *mid-edit*.
 *
 * Every shortcut needs to know whether the author is typing in ordinary text
 * (and inside which elements) before it rewrites anything. The source is
 * half-typed most of the time, so this walks tags rather than parsing, and
 * malformed input degrades into reporting *less* context, never into throwing.
 *
 * Ported from pretext-plus's `xmlTags.ts` (the walker behind its auto-convert
 * triggers and spell checker), extended to report the open elements rather
 * than just a yes/no.
 */

/** An element whose start tag precedes the offset and whose end tag doesn't. */
export interface OpenElement {
  name: string;
  /** Offset of the start tag's `<`. */
  start: number;
  /** Offset just past the start tag's `>`. */
  end: number;
}

export interface XmlContext {
  /**
   * True when the offset is in character data — not inside a tag (including
   * an attribute value), a comment, a CDATA section, or a processing
   * instruction/doctype.
   */
  inText: boolean;
  /** The elements open at the offset, outermost first. */
  open: OpenElement[];
}

/**
 * Index just past a tag's closing `>`, or the end of the source if it is never
 * closed. Quoted attribute values are skipped, so a `>` inside `title="a > b"`
 * doesn't end the tag early.
 */
export const findTagEnd = (source: string, start: number): number => {
  let quote = "";
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
  }
  return source.length;
};

/** Whether `ch` can begin an element name — i.e. whether a `<` before it opens a tag. */
export const isNameStart = (ch: string | undefined): boolean =>
  ch !== undefined && /[A-Za-z_]/.test(ch);

/** The element name starting at `start`, or `""` if there isn't one. */
export const readName = (source: string, start: number): string => {
  const match = /^[A-Za-z_][\w.:-]*/.exec(source.slice(start, start + 128));
  return match ? match[0] : "";
};

/**
 * The context of `offset` in `source`: whether it is in ordinary text, and
 * which elements are open there. Only the text *before* `offset` is read, so
 * a character sitting at `offset` itself (say, a `<` just typed) doesn't
 * affect the answer.
 */
export const scanXmlContext = (source: string, offset: number): XmlContext => {
  const open: OpenElement[] = [];
  let index = 0;

  const skipTo = (
    lt: number,
    opener: string,
    closer: string,
  ): number | null => {
    const close = source.indexOf(closer, lt + opener.length);
    if (close === -1) return null;
    const end = close + closer.length;
    return offset < end ? null : end;
  };

  while (index < offset) {
    const lt = source.indexOf("<", index);
    if (lt === -1 || lt >= offset) return { inText: true, open };
    // From here on, lt < offset.

    let next: number | null;
    if (source.startsWith("<!--", lt)) {
      next = skipTo(lt, "<!--", "-->");
    } else if (source.startsWith("<![CDATA[", lt)) {
      next = skipTo(lt, "<![CDATA[", "]]>");
    } else if (source.startsWith("<?", lt)) {
      next = skipTo(lt, "<?", "?>");
    } else if (source.startsWith("<!", lt)) {
      next = skipTo(lt, "<!", ">");
    } else if (source.startsWith("</", lt)) {
      const end = findTagEnd(source, lt);
      next = offset < end ? null : end;
      if (next !== null) {
        const name = readName(source, lt + 2);
        for (let i = open.length - 1; i >= 0; i--) {
          if (open[i].name === name) {
            open.length = i;
            break;
          }
        }
      }
    } else if (isNameStart(source[lt + 1])) {
      const end = findTagEnd(source, lt);
      next = offset < end ? null : end;
      if (next !== null && source[end - 2] !== "/") {
        open.push({ name: readName(source, lt + 1), start: lt, end });
      }
    } else {
      // A stray '<' that doesn't open a tag — ordinary text; keep scanning.
      next = lt + 1;
    }

    if (next === null) return { inText: false, open };
    index = next;
  }

  return { inText: true, open };
};

/** The innermost open element's name, if any. */
export const innermost = (context: XmlContext): string | undefined =>
  context.open[context.open.length - 1]?.name;

/** Whether any open element is in `names`. */
export const isWithin = (
  context: XmlContext,
  names: ReadonlySet<string>,
): boolean => context.open.some((element) => names.has(element.name));
