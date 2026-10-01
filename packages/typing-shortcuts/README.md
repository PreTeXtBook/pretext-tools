# @pretextbook/typing-shortcuts

Typing shortcuts for PreTeXt XML source, shared by the PreTeXt Tools VS Code extension and the pretext-plus web editor.

| You type                                                          | You get                                                                                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `$x^2$`                                                           | `<m>x^2</m>`                                                                                                                |
| `$$\sum_i i$$`                                                    | `<md>\sum_i i</md>`                                                                                                         |
| `a < b`, `a > b`, `A & B` in text                                 | `a &lt; b`, `a &gt; b`, `A &amp; B`                                                                                         |
| `a < b`, `a > b` inside `<m>`, `<md>`, …                          | `a \lt b`, `a \gt b`                                                                                                        |
| Enter twice inside a `<p>` (or Shift+Enter)                       | the paragraph ends and a new one starts, splitting at the caret                                                             |
| Enter twice (or Shift+Enter) in the text of an `<li>`             | the item's text becomes two `<p>`s, splitting at the caret                                                                  |
| Shift+Enter outside a `<p>`                                       | a new `<p>`                                                                                                                 |
| `- ` or `* ` at the start of a line in a `<p>`                    | a `<ul>` with the caret in its first `<li>`                                                                                 |
| `1. ` (or `a.`, `(i)`, `A)`, …) at the start of a line in a `<p>` | an `<ol>` (with `marker="(i)"` etc. for the others)                                                                         |
| any of those markers at the start of a line in an `<li>`          | that item ends and the next one starts (likewise in an empty `<p>` that ends an item)                                       |
| `theorem:` + Enter on a line of its own, outside a paragraph      | the `<theorem>` snippet (likewise `definition:`, `proof:`, `example:`, … — see `ENVIRONMENT_NAMES`)                         |
| `*word*`, `**word**`, `` `code` ``                                | `<em>word</em>`, `<alert>word</alert>`, `<c>code</c>` (on the closing delimiter)                                            |
| `_word_` then a space, `"word"` then a space                      | `<term>word</term>`, `<q>word</q>` (punctuation may come before the space)                                                  |
| `[text](url)`                                                     | `<url href="url">text</url>`                                                                                                |
| `--`, `---`, `...`, then a space                                  | `<ndash/>`, `<mdash/>`, `<ellipsis/>`                                                                                       |
| `@` after a space                                                 | `<xref ref="\|"/>` with the id completions open                                                                             |
| ` ```python ` + Enter on a line of its own                        | `<program language="python"><code>…</code></program>`; a bare ` ``` ` gives `<pre>`, and inside a `<p>` either gives `<cd>` |

The Markdown-style delimiters pair only within one line and one text node (complete inline elements such as `<m>x</m>` may sit inside), follow CommonMark's flanking rules (`2*3*4` and `snake_case_` stay as typed), and do nothing inside math, verbatim elements, or a `` ` ``/`$` span that is still open.

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
  inlineMarkup: true,
  typography: true,
  crossReferences: true,
  codeBlocks: true,
  lists: true,
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

An edit replaces `start`–`end` with `text`. Plain edits carry a `caret` offset for afterwards; edits with `snippet: true` are snippet syntax for the host's snippet engine (`snippetToPlainText` flattens one for hosts without). An edit with `suggest: true` (the `@` → `<xref>` shortcut) wants the host's completion list opened once it is applied.

A closing character typed over one the editor auto-closed (`)`, `]`, `}`, `"`, `'`, `` ` ``) arrives as a one-character replacement rather than an insertion; it counts as typing, so `[text](url)` converts even with bracket auto-closing on.

A "double Enter" is two consecutive Enters with nothing typed in between, tracked by the instance, so a single Enter at the start of a line never splits a paragraph. Call `reset()` for any change you don't pass to `afterChange`: undo/redo, remote edits, and the shortcut's own edit if your listener skips it.
