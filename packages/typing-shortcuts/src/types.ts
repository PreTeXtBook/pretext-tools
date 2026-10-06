/**
 * One replacement from an editor's content-change event. VS Code's
 * `TextDocumentContentChangeEvent` and Monaco's `IModelContentChange` both
 * have this shape, so either can be passed straight through.
 */
export interface TextChange {
  /** Offset of the replaced range, in the document before the change. */
  rangeOffset: number;
  /** Length of the replaced range. */
  rangeLength: number;
  /** The text that replaced it. */
  text: string;
}

/** Which shortcut produced an edit. */
export type ShortcutKind =
  | "math"
  | "escape"
  | "paragraph"
  | "environment"
  | "markup"
  | "typography"
  | "xref"
  | "code-block"
  | "list"
  | "wrap";

/**
 * An edit for the host editor to apply: replace `start`–`end` (offsets into
 * the document as it is now) with `text`.
 */
export interface ShortcutEdit {
  kind: ShortcutKind;
  start: number;
  end: number;
  text: string;
  /**
   * `text` is snippet syntax (`$1`, `${1:placeholder}`, `$0`), to be inserted
   * through the host's snippet engine — which also re-indents it to match
   * the line it lands on.
   */
  snippet?: boolean;
  /**
   * For snippets: `text` is already indented as it should end up, so the host
   * must insert it as is (VS Code's `keepWhitespace`, Monaco's
   * `adjustWhitespace: false`). Snippet engines don't agree on re-indenting a
   * placeholder's text: Monaco's does, VS Code's `insertSnippet` doesn't.
   */
  keepWhitespace?: boolean;
  /**
   * For plain-text edits: where the caret belongs afterwards, as an offset
   * into the document *after* the edit.
   */
  caret?: number;
  /**
   * Open the host's completion list once the edit is in — for
   * `<xref ref="">`, whose ids the language server completes.
   */
  suggest?: boolean;
}

export interface TypingShortcutsOptions {
  /** `$…$` → `<m>…</m>` and `$$…$$` → `<md>…</md>`. Default `true`. */
  mathDelimiters?: boolean;
  /**
   * A bare `<`, `>` or `&` → `&lt;`, `&gt;`, `&amp;` in text, and `<`/`>` →
   * `\lt`/`\gt` inside math. Default `true`.
   */
  escapes?: boolean;
  /**
   * Inside a `<p>`, a double Enter (or Shift+Enter, via
   * {@link TypingShortcuts.newParagraph}) splits the paragraph, and in the
   * text of an `<li>` splits it into two `<p>`s; elsewhere `newParagraph`
   * starts a new one. Default `true`.
   */
  paragraphs?: boolean;
  /** `theorem:` + Enter on a line of its own expands the theorem snippet. Default `true`. */
  environments?: boolean;
  /**
   * Markdown-style inline markup: `*em*` → `<em>`, `**alert**` → `<alert>` and
   * `` `code` `` → `<c>` on the closing delimiter; `_term_` → `<term>` and
   * `"quote"` → `<q>` on the space after the closing delimiter;
   * `[text](url)` → `<url>` on the `)`. Default `true`.
   */
  inlineMarkup?: boolean;
  /**
   * `--`, `---` and `...` → `<ndash/>`, `<mdash/>`, `<ellipsis/>` on the space
   * typed after them. Default `true`.
   */
  typography?: boolean;
  /**
   * `@` typed after a space → `<xref ref=""/>`, with the id completions open.
   * Default `true`.
   */
  crossReferences?: boolean;
  /**
   * ```` ``` ```` + Enter on a line of its own → `<pre>`, and
   * ```` ```python ```` + Enter → `<program language="python">` (`<cd>`
   * inside a paragraph). Default `true`.
   */
  codeBlocks?: boolean;
  /**
   * At the start of a line in a `<p>`, `- ` or `* ` starts a `<ul>` and `1. `
   * an `<ol>`; in an `<li>`, a marker starts the next item. Default `true`.
   */
  lists?: boolean;
  /**
   * Typed over a selection, `$`, `*`, `` ` `` and `"` wrap it in `<m>`,
   * `<em>`, `<c>` and `<q>`, and `<` wraps it in an element whose name goes
   * into both tags at once. Works with the editor's auto-surround: the
   * language configuration must list these as `surroundingPairs` (with `>`
   * closing `<`). Default `true`.
   */
  wrapSelection?: boolean;
}

/** What the host knows about the editor when a change happens. */
export interface EditorState {
  /** One level of indentation, e.g. `"  "` or `"\t"`. Default two spaces. */
  indentUnit?: string;
  /**
   * The document's line break, `"\n"` or `"\r\n"`. Default: whichever the
   * text already contains — pass it for documents that may have none yet,
   * since editors normalize inserted line breaks and the caret would drift.
   */
  eol?: string;
  /**
   * The caret offset after the change, when the host knows it reliably at
   * this point. A change that doesn't end at the caret wasn't typed there —
   * a collaborator's edit, say — and is ignored.
   */
  caret?: number;
  /**
   * How many selections (carets) the editor has, when the host knows it. Two
   * carets typing the same character look just like an auto-surround of the
   * text between them; only a single selection is ever surrounded.
   */
  selections?: number;
}
