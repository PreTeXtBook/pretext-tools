/**
 * Test helpers: documents are written with `|` marking the caret.
 */
import { snippetToPlainText } from "./snippets";
import type { ShortcutEdit, TextChange } from "./types";

export interface Doc {
  source: string;
  caret: number;
}

/** Parse `"<p>text|</p>"` into the source and the caret offset. */
export const doc = (marked: string): Doc => {
  const caret = marked.indexOf("|");
  if (caret === -1) throw new Error(`no caret in ${JSON.stringify(marked)}`);
  return { source: marked.slice(0, caret) + marked.slice(caret + 1), caret };
};

/** Render a document back with `|` at the caret. */
export const show = ({ source, caret }: Doc): string =>
  source.slice(0, caret) + "|" + source.slice(caret);

/**
 * Apply a shortcut edit. Snippets are flattened to plain text, with the caret
 * on their first tab stop and without the re-indentation a snippet engine
 * would add.
 */
export const applyEdit = (source: string, edit: ShortcutEdit): Doc => {
  if (edit.snippet) {
    const plain = snippetToPlainText(edit.text);
    return {
      source: source.slice(0, edit.start) + plain.text + source.slice(edit.end),
      caret: edit.start + plain.caret,
    };
  }
  return {
    source: source.slice(0, edit.start) + edit.text + source.slice(edit.end),
    caret: edit.caret ?? edit.start + edit.text.length,
  };
};

/**
 * Type `text` at the caret the way an editor does, returning the new document
 * and the change event it would emit. An Enter (`"\n"`) copies the current
 * line's indentation, like the editors' default auto-indent.
 */
export const type = (
  { source, caret }: Doc,
  text: string,
): { doc: Doc; changes: TextChange[] } => {
  let inserted = text;
  if (text === "\n") {
    const lineStart = source.lastIndexOf("\n", caret - 1) + 1;
    inserted += /^[ \t]*/.exec(source.slice(lineStart))![0];
  }
  return {
    doc: {
      source: source.slice(0, caret) + inserted + source.slice(caret),
      caret: caret + inserted.length,
    },
    changes: [{ rangeOffset: caret, rangeLength: 0, text: inserted }],
  };
};
