/**
 * Typing shortcuts in PreTeXt documents: `$x$` → `<m>x</m>`, escaping a bare
 * `<`/`>`/`&`, double Enter or Shift+Enter for a new paragraph, and
 * `theorem:` + Enter for the theorem snippet.
 *
 * All the decisions live in `@pretextbook/typing-shortcuts` (shared with the
 * pretext-plus web editor); this file feeds it document changes and applies
 * the edits it returns.
 */
import {
  EndOfLine,
  Range,
  Selection,
  SnippetString,
  commands,
  window,
  workspace,
  type Disposable,
  type TextDocument,
  type TextEditor,
} from "vscode";
import {
  TypingShortcuts,
  type EditorState,
  type ShortcutEdit,
  type TypingShortcutsOptions,
} from "@pretextbook/typing-shortcuts";

/** Language id of PreTeXt XML documents (not the LaTeX/Markdown flavours). */
const PRETEXT_LANGUAGE_ID = "pretext";

const SETTINGS = "pretext-tools.typingShortcuts";

export const NEW_PARAGRAPH_COMMAND = "pretext-tools.newParagraph";

function readOptions(): TypingShortcutsOptions {
  const config = workspace.getConfiguration(SETTINGS);
  return {
    mathDelimiters: config.get("mathDelimiters", true),
    escapes: config.get("escapeCharacters", true),
    paragraphs: config.get("paragraphs", true),
    environments: config.get("environments", true),
  };
}

/** The indentation and line break the shortcuts should write. */
function editorState(editor: TextEditor): EditorState {
  const { insertSpaces, indentSize, tabSize } = editor.options;
  const size =
    typeof indentSize === "number"
      ? indentSize
      : typeof tabSize === "number"
        ? tabSize
        : 2;
  return {
    indentUnit: insertSpaces === false ? "\t" : " ".repeat(size),
    eol: editor.document.eol === EndOfLine.CRLF ? "\r\n" : "\n",
  };
}

/**
 * Apply `edit`, computed against version `version` of the editor's document.
 * VS Code refuses the edit if the document has moved on since (the author
 * kept typing), which is the right outcome for a stale shortcut.
 */
async function applyEdit(
  editor: TextEditor,
  edit: ShortcutEdit,
  version: number,
): Promise<void> {
  const { document } = editor;
  if (document.version !== version) {
    return;
  }
  const range = new Range(
    document.positionAt(edit.start),
    document.positionAt(edit.end),
  );
  if (edit.snippet) {
    await editor.insertSnippet(new SnippetString(edit.text), range);
    return;
  }
  // Undo stops on both sides make the shortcut its own undo step: one Ctrl+Z
  // restores exactly what was typed.
  const applied = await editor.edit(
    (builder) => builder.replace(range, edit.text),
    {
      undoStopBefore: true,
      undoStopAfter: true,
    },
  );
  if (applied && edit.caret !== undefined && document.version === version + 1) {
    const caret = document.positionAt(edit.caret);
    editor.selection = new Selection(caret, caret);
  }
}

export function registerTypingShortcuts(): Disposable {
  let options = readOptions();
  // One session per document: the memory of the previous Enter (for a double
  // Enter) belongs to a buffer.
  const sessions = new Map<string, TypingShortcuts>();
  const sessionFor = (document: TextDocument): TypingShortcuts => {
    const key = document.uri.toString();
    let session = sessions.get(key);
    if (!session) {
      session = new TypingShortcuts(options);
      sessions.set(key, session);
    }
    return session;
  };

  const disposables: Disposable[] = [
    workspace.onDidChangeTextDocument((event) => {
      const { document } = event;
      if (
        document.languageId !== PRETEXT_LANGUAGE_ID ||
        event.contentChanges.length === 0
      ) {
        return;
      }
      const session = sessionFor(document);
      const editor = window.activeTextEditor;
      // Undo/redo, and changes to a document the author isn't typing in, are
      // never typing.
      if (event.reason !== undefined || editor?.document !== document) {
        session.reset();
        return;
      }
      const edit = session.afterChange(
        () => document.getText(),
        event.contentChanges,
        editorState(editor),
      );
      if (edit) {
        void applyEdit(editor, edit, document.version);
      }
    }),

    commands.registerCommand(NEW_PARAGRAPH_COMMAND, async () => {
      const editor = window.activeTextEditor;
      if (!editor) {
        return;
      }
      const { document, selections, selection } = editor;
      const edit =
        document.languageId === PRETEXT_LANGUAGE_ID && selections.length === 1
          ? sessionFor(document).newParagraph(
              document.getText(),
              document.offsetAt(selection.start),
              document.offsetAt(selection.end),
              editorState(editor),
            )
          : null;
      if (edit) {
        await applyEdit(editor, edit, document.version);
      } else {
        await commands.executeCommand("type", { text: "\n" });
      }
    }),

    workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(SETTINGS)) {
        return;
      }
      options = readOptions();
      for (const session of sessions.values()) {
        session.setOptions(options);
      }
    }),

    workspace.onDidCloseTextDocument((document) => {
      sessions.delete(document.uri.toString());
    }),
  ];

  return {
    dispose: () => disposables.forEach((disposable) => disposable.dispose()),
  };
}
