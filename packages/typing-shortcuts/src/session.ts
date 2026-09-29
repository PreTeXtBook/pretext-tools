/**
 * The editor-facing entry point: feed it every content change of a PreTeXt
 * document, and it answers with the shortcut edit (if any) the change
 * triggers.
 *
 * It works from the change *after* it has been applied — the same thing
 * VS Code's `onDidChangeTextDocument` and Monaco's `onDidChangeModelContent`
 * deliver — rather than intercepting keys, so an ordinary keystroke goes
 * through the editor untouched (auto-indent, auto-closing, multi-cursor) and
 * only then gets rewritten. Rewrites are separate edits, so one undo reverts
 * the shortcut and leaves what was typed.
 */
import { environmentEdit } from "./environments";
import { escapeBeforeWhitespace, escapeGreaterThan } from "./escapes";
import { mathDelimiterEdit } from "./math-delimiters";
import { insertParagraphEdit, splitParagraphEdit } from "./paragraphs";
import type {
  EditorState,
  ShortcutEdit,
  TextChange,
  TypingShortcutsOptions,
} from "./types";

const DEFAULT_OPTIONS: Required<TypingShortcutsOptions> = {
  mathDelimiters: true,
  escapes: true,
  paragraphs: true,
  environments: true,
};

const DEFAULT_INDENT = "  ";

const ENTER = /^\r?\n[ \t]*(\r?\n[ \t]*)?$/;

/** A change that looks like the author typing at one caret. */
export interface TypedInput {
  /** Where the typed text starts, in the document after the change. */
  start: number;
  /** Where it ends, in the document after the change. */
  end: number;
  text: string;
  /** Where it was typed, in the document before the change. */
  before: number;
  /** An Enter (with any auto-indent) rather than a single character. */
  enter: boolean;
}

/**
 * Recognize typing in one change event: a single character inserted at one
 * caret, or an Enter — a line break plus indentation, or two of them when the
 * editor splits a tag pair (`<p>|</p>`) onto three lines.
 *
 * Other changes in the same event must be pure deletions: when Enter leaves a
 * line holding only auto-inserted indentation, the editor trims that line in
 * the same event.
 */
export const typedInput = (
  changes: readonly TextChange[],
): TypedInput | null => {
  let typed: TextChange | undefined;
  for (const change of changes) {
    if (change.text.length === 0) continue;
    if (typed) return null;
    typed = change;
  }
  if (!typed) return null;

  const enter = ENTER.test(typed.text);
  if (!enter && (typed.text.length !== 1 || typed.rangeLength !== 0)) {
    return null;
  }

  let start = typed.rangeOffset;
  for (const change of changes) {
    if (change !== typed && change.rangeOffset < typed.rangeOffset) {
      start -= change.rangeLength;
    }
  }
  return {
    start,
    end: start + typed.text.length,
    text: typed.text,
    before: typed.rangeOffset,
    enter,
  };
};

/**
 * Typing shortcuts for one PreTeXt document. Keep one instance per document
 * (or per editor model): it remembers the previous Enter so it can recognize
 * a double Enter.
 */
export class TypingShortcuts {
  private options: Required<TypingShortcutsOptions>;
  /** The text the most recent change inserted, if that change was an Enter. */
  private lastEnter: { start: number; end: number } | null = null;

  constructor(options: TypingShortcutsOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  setOptions(options: TypingShortcutsOptions): void {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Forget the typing history. Call it for changes that aren't passed to
   * {@link afterChange} — undo/redo, a whole-document reset, a collaborator's
   * edit, the shortcut edits themselves — so a double Enter is only ever two
   * Enters in a row.
   */
  reset(): void {
    this.lastEnter = null;
  }

  /**
   * Call after every content change, with the document as it is now (or a
   * function returning it, read only when a change could trigger something).
   * Returns the edit to apply, or `null`.
   */
  afterChange(
    source: string | (() => string),
    changes: readonly TextChange[],
    state: EditorState = {},
  ): ShortcutEdit | null {
    const previousEnter = this.lastEnter;
    this.lastEnter = null;
    const input = typedInput(changes);
    if (!input) return null;
    if (
      state.caret !== undefined &&
      (state.caret < input.start || state.caret > input.end)
    ) {
      return null;
    }
    if (input.enter) this.lastEnter = { start: input.start, end: input.end };

    const text = typeof source === "string" ? source : source();
    const edit = input.enter
      ? this.afterEnter(text, input, previousEnter, state)
      : this.afterCharacter(text, input);
    if (edit) this.lastEnter = null;
    return edit;
  }

  /**
   * Shift+Enter: inside a `<p>`, end it at the caret and start the next one;
   * elsewhere, start a new `<p>`. Returns `null` when neither applies (or
   * there is a selection), in which case the host should insert an ordinary
   * line break.
   */
  newParagraph(
    source: string,
    selectionStart: number,
    selectionEnd: number,
    state: EditorState = {},
  ): ShortcutEdit | null {
    this.lastEnter = null;
    if (!this.options.paragraphs || selectionStart !== selectionEnd) {
      return null;
    }
    return (
      splitParagraphEdit(source, selectionStart, state.eol) ??
      insertParagraphEdit(
        source,
        selectionStart,
        state.indentUnit ?? DEFAULT_INDENT,
        state.eol,
      )
    );
  }

  private afterCharacter(
    source: string,
    input: TypedInput,
  ): ShortcutEdit | null {
    const { mathDelimiters, escapes } = this.options;
    switch (input.text) {
      case "$":
        return mathDelimiters ? mathDelimiterEdit(source, input.start) : null;
      case ">":
        return escapes ? escapeGreaterThan(source, input.start) : null;
      case " ":
      case "\t":
        return escapes
          ? escapeBeforeWhitespace(source, input.start, input.end)
          : null;
      default:
        return null;
    }
  }

  private afterEnter(
    source: string,
    input: TypedInput,
    previousEnter: { start: number; end: number } | null,
    state: EditorState,
  ): ShortcutEdit | null {
    const { environments, escapes, paragraphs } = this.options;
    if (environments) {
      const edit = environmentEdit(source, input.start, input.end);
      if (edit) return edit;
    }
    if (escapes) {
      const edit = escapeBeforeWhitespace(source, input.start, input.end);
      if (edit) return edit;
    }
    // A double Enter: this one was typed inside the text the previous one
    // inserted, i.e. where it left the caret, with nothing typed in between.
    if (
      paragraphs &&
      previousEnter &&
      input.before > previousEnter.start &&
      input.before <= previousEnter.end
    ) {
      return splitParagraphEdit(source, input.end, state.eol);
    }
    return null;
  }
}
