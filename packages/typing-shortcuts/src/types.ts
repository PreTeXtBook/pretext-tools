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
export type ShortcutKind = "math" | "escape" | "paragraph" | "environment";

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
   * For plain-text edits: where the caret belongs afterwards, as an offset
   * into the document *after* the edit.
   */
  caret?: number;
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
   * {@link TypingShortcuts.newParagraph}) splits the paragraph; elsewhere
   * `newParagraph` starts a new one. Default `true`.
   */
  paragraphs?: boolean;
  /** `theorem:` + Enter on a line of its own expands the theorem snippet. Default `true`. */
  environments?: boolean;
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
}
