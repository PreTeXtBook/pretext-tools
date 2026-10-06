/**
 * Monaco wiring for the typing shortcuts: one content-change subscription
 * that feeds {@link TypingShortcuts}, plus a Shift+Enter action for a new
 * paragraph and a "wrap selection" action.
 *
 * `monaco` and `editor` are typed loosely (as pretext-plus's editor configs
 * do), so this package needs no `monaco-editor` dependency.
 *
 * Edits are applied synchronously inside the content-change listener. That is
 * safe because Monaco defers the editor-level `onDidChangeModelContent` until
 * the typing operation — including the caret update — has finished, which
 * also means the caret read here is where the author's typing left it.
 */
import { TypingShortcuts } from "./session";
import { snippetToPlainText } from "./snippets";
import type { ShortcutEdit, TypingShortcutsOptions } from "./types";
import { wrapSelectionEdit } from "./wrap";

export interface MonacoTypingShortcutsOptions extends TypingShortcutsOptions {
  /**
   * Return `true` while the host is applying a change that didn't come from
   * this editor's user — a collaborator's edit arriving through a CRDT
   * binding, say. Such changes never trigger a shortcut.
   */
  isRemoteChange?: () => boolean;
  /**
   * Return `false` to veto an edit, e.g. one reaching into read-only lines.
   * Receives the Monaco `Range` the edit would replace.
   */
  canEdit?: (range: any) => boolean;
}

const EDIT_SOURCE = "pretext-typing-shortcuts";

/** Monaco's snippet controller contribution id (stable across releases). */
const SNIPPET_CONTROLLER = "snippetController2";

const indentUnitOf = (model: any): string => {
  const { insertSpaces, indentSize, tabSize } = model.getOptions();
  return insertSpaces ? " ".repeat(indentSize ?? tabSize) : "\t";
};

/**
 * Register the PreTeXt typing shortcuts on a Monaco editor. Returns a
 * disposable that removes them — dispose it when the editor stops showing
 * PreTeXt XML.
 */
export const registerMonacoTypingShortcuts = (
  monaco: any,
  editor: any,
  options: MonacoTypingShortcutsOptions = {},
): { dispose: () => void } => {
  const shortcuts = new TypingShortcuts(options);
  // Guards against the change event a shortcut's own edit triggers.
  let applying = false;

  const apply = (model: any, edit: ShortcutEdit): void => {
    const from = model.getPositionAt(edit.start);
    const to = model.getPositionAt(edit.end);
    const range = new monaco.Range(
      from.lineNumber,
      from.column,
      to.lineNumber,
      to.column,
    );
    if (options.canEdit && !options.canEdit(range)) return;

    let text = edit.text;
    let caret = edit.caret;
    const snippets = edit.snippet
      ? editor.getContribution?.(SNIPPET_CONTROLLER)
      : undefined;
    if (edit.snippet && !snippets) {
      const plain = snippetToPlainText(edit.text);
      text = plain.text;
      caret = edit.start + plain.caret;
    }

    applying = true;
    try {
      // Undo stops on both sides make the shortcut its own undo step: one
      // Ctrl+Z restores exactly what was typed.
      model.pushStackElement();
      if (snippets) {
        editor.setSelection(range);
        if (edit.keepWhitespace) {
          snippets.insert(text, { adjustWhitespace: false });
        } else {
          snippets.insert(text);
        }
      } else {
        editor.executeEdits(
          EDIT_SOURCE,
          [{ range, text, forceMoveMarkers: true }],
          () => {
            if (caret === undefined) return null;
            const at = model.getPositionAt(caret);
            return [
              new monaco.Selection(
                at.lineNumber,
                at.column,
                at.lineNumber,
                at.column,
              ),
            ];
          },
        );
      }
      model.pushStackElement();
    } finally {
      applying = false;
    }
    shortcuts.reset();
    if (edit.suggest) {
      editor.trigger(EDIT_SOURCE, "editor.action.triggerSuggest", {});
    }
  };

  const contentListener = editor.onDidChangeModelContent((event: any) => {
    if (applying) return;
    const model = editor.getModel();
    if (
      !model ||
      event.isFlush ||
      event.isUndoing ||
      event.isRedoing ||
      options.isRemoteChange?.()
    ) {
      shortcuts.reset();
      return;
    }
    const position = editor.getPosition();
    const edit = shortcuts.afterChange(() => model.getValue(), event.changes, {
      indentUnit: indentUnitOf(model),
      eol: model.getEOL(),
      caret: position ? model.getOffsetAt(position) : undefined,
      selections: editor.getSelections()?.length,
    });
    if (edit) apply(model, edit);
  });

  const newParagraph =
    options.paragraphs === false
      ? null
      : editor.addAction({
          id: "pretext.typingShortcuts.newParagraph",
          label: "PreTeXt: New Paragraph",
          keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.Enter],
          keybindingContext:
            "editorTextFocus && !editorReadonly && !suggestWidgetVisible",
          run: () => {
            const model = editor.getModel();
            const selections = editor.getSelections();
            const edit =
              model && selections?.length === 1
                ? shortcuts.newParagraph(
                    model.getValue(),
                    model.getOffsetAt(selections[0].getStartPosition()),
                    model.getOffsetAt(selections[0].getEndPosition()),
                    { indentUnit: indentUnitOf(model), eol: model.getEOL() },
                  )
                : null;
            if (edit) {
              apply(model, edit);
            } else {
              editor.trigger("keyboard", "type", { text: "\n" });
            }
          },
        });

  // Wrap the selection in the element named by `args.element` (run it with
  // `editor.trigger(source, id, { element: "m" })`), or with none given, in
  // one named by typing, as typing `<` over it does.
  const wrapSelection = editor.addAction({
    id: "pretext.typingShortcuts.wrapSelection",
    label: "PreTeXt: Wrap Selection in Element",
    run: (_editor: any, args?: { element?: unknown }) => {
      const model = editor.getModel();
      const selection = editor.getSelection();
      if (!model || !selection) return;
      const element =
        typeof args?.element === "string" && args.element.trim()
          ? args.element.trim()
          : null;
      const edit = wrapSelectionEdit(
        model.getValue(),
        model.getOffsetAt(selection.getStartPosition()),
        model.getOffsetAt(selection.getEndPosition()),
        element,
        { indentUnit: indentUnitOf(model), eol: model.getEOL() },
      );
      if (edit) apply(model, edit);
    },
  });

  return {
    dispose: () => {
      contentListener?.dispose?.();
      newParagraph?.dispose?.();
      wrapSelection?.dispose?.();
    },
  };
};
