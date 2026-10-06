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
import { codeBlockEdit } from "./code-blocks";
import { environmentEdit } from "./environments";
import { escapeBeforeWhitespace, escapeGreaterThan } from "./escapes";
import {
  codeSpanEdit,
  emphasisEdit,
  linkEdit,
  wrapBeforeWhitespaceEdit,
  xrefEdit,
} from "./inline-markup";
import { mathDelimiterEdit } from "./math-delimiters";
import { listMarkerEdit } from "./lists";
import {
  insertParagraphEdit,
  splitListItemEdit,
  splitParagraphEdit,
} from "./paragraphs";
import { typographyEdit } from "./typography";
import { surroundEdit } from "./wrap";
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
  inlineMarkup: true,
  typography: true,
  crossReferences: true,
  codeBlocks: true,
  lists: true,
  wrapSelection: true,
};

const DEFAULT_INDENT = "  ";

const ENTER = /^\r?\n[ \t]*(\r?\n[ \t]*)?$/;

/**
 * Closing characters an editor types *over* when the next character is the
 * one it auto-closed: the change replaces that character with itself.
 */
const OVERTYPED: ReadonlySet<string> = new Set([")", "]", "}", '"', "'", "`"]);

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
 * caret (or typed over an auto-closed copy of itself), or an Enter — a line break plus indentation, or two of them when the
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
  if (
    !enter &&
    (typed.text.length !== 1 ||
      typed.rangeLength > (OVERTYPED.has(typed.text) ? 1 : 0))
  ) {
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

/** A selection the editor has just surrounded with a pair of characters. */
export interface SurroundInput {
  /** The character put before the selection. */
  open: string;
  /** The character put after it. */
  close: string;
  /** Offset of `open`, in the document after the change. */
  start: number;
  /** Offset just past `close`, in the document after the change. */
  end: number;
}

/**
 * Recognize an auto-surround in one change event: a character inserted at
 * each end of a selection, which is how editors apply a `surroundingPairs`
 * character typed with text selected (both insertions placed in the document
 * as it was, leaving the text between them selected).
 */
export const surroundInput = (
  changes: readonly TextChange[],
): SurroundInput | null => {
  if (changes.length !== 2) return null;
  const [first, second] =
    changes[0].rangeOffset <= changes[1].rangeOffset
      ? changes
      : [changes[1], changes[0]];
  if (
    first.rangeLength !== 0 ||
    second.rangeLength !== 0 ||
    first.text.length !== 1 ||
    second.text.length !== 1 ||
    first.rangeOffset >= second.rangeOffset
  ) {
    return null;
  }
  return {
    open: first.text,
    close: second.text,
    start: first.rangeOffset,
    end: second.rangeOffset + 2,
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
    const surround = surroundInput(changes);
    if (surround) {
      if (
        !this.options.wrapSelection ||
        (state.selections ?? 1) !== 1 ||
        (state.caret !== undefined &&
          (state.caret < surround.start || state.caret > surround.end))
      ) {
        return null;
      }
      const { open, close, start, end } = surround;
      const text = typeof source === "string" ? source : source();
      return surroundEdit(text, open, close, start, end, state);
    }
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
      : this.afterCharacter(text, input, state);
    if (edit) this.lastEnter = null;
    return edit;
  }

  /**
   * Shift+Enter: inside a `<p>`, end it at the caret and start the next one;
   * in a list item's text, split that into two paragraphs; elsewhere, start a
   * new `<p>`. Returns `null` when none applies (or there is a selection), in
   * which case the host should insert an ordinary line break.
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
    const indentUnit = state.indentUnit ?? DEFAULT_INDENT;
    return (
      splitParagraphEdit(source, selectionStart, state.eol) ??
      splitListItemEdit(source, selectionStart, indentUnit, state.eol) ??
      insertParagraphEdit(source, selectionStart, indentUnit, state.eol)
    );
  }

  private afterCharacter(
    source: string,
    input: TypedInput,
    state: EditorState,
  ): ShortcutEdit | null {
    const {
      mathDelimiters,
      escapes,
      inlineMarkup,
      typography,
      crossReferences,
      lists,
    } = this.options;
    const at = input.start;
    switch (input.text) {
      case "$":
        return mathDelimiters ? mathDelimiterEdit(source, at) : null;
      case ">":
        return escapes ? escapeGreaterThan(source, at) : null;
      case "*":
        return inlineMarkup ? emphasisEdit(source, at) : null;
      case "`":
        return inlineMarkup ? codeSpanEdit(source, at) : null;
      case ")":
        return inlineMarkup ? linkEdit(source, at) : null;
      case "@":
        return crossReferences ? xrefEdit(source, at) : null;
      case " ":
      case "\t":
        return (
          (escapes ? escapeBeforeWhitespace(source, at, input.end) : null) ??
          (lists
            ? listMarkerEdit(
                source,
                at,
                state.indentUnit ?? DEFAULT_INDENT,
                state.eol,
              )
            : null) ??
          (inlineMarkup ? wrapBeforeWhitespaceEdit(source, at) : null) ??
          (typography ? typographyEdit(source, at) : null)
        );
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
    const { codeBlocks, environments, escapes, paragraphs } = this.options;
    if (codeBlocks) {
      const edit = codeBlockEdit(source, input.start, input.end);
      if (edit) return edit;
    }
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
      return (
        splitParagraphEdit(source, input.end, state.eol) ??
        splitListItemEdit(
          source,
          input.end,
          state.indentUnit ?? DEFAULT_INDENT,
          state.eol,
        )
      );
    }
    return null;
  }
}
