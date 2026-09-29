# @pretextbook/typing-shortcuts

Typing shortcuts for PreTeXt XML source, shared by the PreTeXt Tools VS Code extension and the pretext-plus web editor.

| You type                                                     | You get                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `$x^2$`                                                      | `<m>x^2</m>`                                                                                        |
| `$$\sum_i i$$`                                               | `<md>\sum_i i</md>`                                                                                 |
| `a < b`, `a > b`, `A & B` in text                            | `a &lt; b`, `a &gt; b`, `A &amp; B`                                                                 |
| `a < b`, `a > b` inside `<m>`, `<md>`, …                     | `a \lt b`, `a \gt b`                                                                                |
| Enter twice inside a `<p>` (or Shift+Enter)                  | the paragraph ends and a new one starts, splitting at the caret                                     |
| Shift+Enter outside a `<p>`                                  | a new `<p>`                                                                                         |
| `theorem:` + Enter on a line of its own, outside a paragraph | the `<theorem>` snippet (likewise `definition:`, `proof:`, `example:`, … — see `ENVIRONMENT_NAMES`) |

Each shortcut is applied as a separate edit with undo stops around it, so one undo restores exactly what was typed. The snippets are the ones `@pretextbook/completions` offers, so `theorem:` inserts the same thing as picking `<theorem>` from the completion list.

## Monaco

```ts
import { registerMonacoTypingShortcuts } from "@pretextbook/typing-shortcuts";

const registration = registerMonacoTypingShortcuts(monaco, editor, {
  // All optional:
  mathDelimiters: true,
  escapes: true,
  paragraphs: true, // also registers the Shift+Enter action
  environments: true,
  // A collaborator's edit arriving through a CRDT binding must not trigger shortcuts.
  isRemoteChange: () => collabBinding.applyingRemote,
  // Veto edits that would reach into read-only lines.
  canEdit: (range) => !lockedLines.includes(range.startLineNumber),
});

// When the editor stops showing PreTeXt XML:
registration.dispose();
```

In pretext-plus this replaces `autoConvert.ts` (and the math, angle-bracket and ampersand triggers behind it): return `registerMonacoTypingShortcuts(monaco, editor, …)` from `pretextConfig.registerMonacoExtensions` in its place.

## Other editors

`TypingShortcuts` holds the logic and needs only the document text and each change event, which VS Code (`onDidChangeTextDocument`) and Monaco (`onDidChangeModelContent`) both deliver in the same `{ rangeOffset, rangeLength, text }` shape. Keep one instance per document:

```ts
const shortcuts = new TypingShortcuts(options);

onDocumentChange((changes) => {
  if (isUndoRedo || isRemote) return shortcuts.reset();
  const edit = shortcuts.afterChange(() => getText(), changes, {
    indentUnit: "  ",
    eol: "\n",
  });
  if (edit) apply(edit); // then shortcuts.reset()
});

onShiftEnter(() => {
  const edit = shortcuts.newParagraph(
    getText(),
    selectionStart,
    selectionEnd,
    state,
  );
  edit ? apply(edit) : insertNewline();
});
```

An edit replaces `start`–`end` with `text`. Plain edits carry a `caret` offset for afterwards; edits with `snippet: true` are snippet syntax for the host's snippet engine (`snippetToPlainText` flattens one for hosts without).

A "double Enter" is two consecutive Enters with nothing typed in between, tracked by the instance, so a single Enter at the start of a line never splits a paragraph. Call `reset()` for any change you don't pass to `afterChange`: undo/redo, remote edits, and the shortcut's own edit if your listener skips it.
