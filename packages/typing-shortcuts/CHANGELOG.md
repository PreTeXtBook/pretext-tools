# @pretextbook/typing-shortcuts

## 0.3.0

### Minor Changes

- 20fd35a: Wrap a selection by typing over it: `$`, `*`, `` ` `` and `"` wrap it in
  `<m>`, `<em>`, `<c>` and `<q>`, and `<` wraps it in an element named by
  typing, into both tags at once (a mirrored tab stop), with the completions
  open. The selection stays selected inside the element.

  This works with the editor's own auto-surround, so the host's language
  configuration must list `$`, `*`, `` ` ``, `"` and `<`/`>` as
  `surroundingPairs`; turn it off with the new `wrapSelection` option. Hosts
  should pass `selections` in the `EditorState`, since two carets typing `$`
  look like a surround. `wrapSelectionEdit` wraps a selection in an element by
  name, and the Monaco adapter adds a `pretext.typingShortcuts.wrapSelection`
  action for it.

  Wrap edits are already indented as they are to end up and carry
  `keepWhitespace: true`: insert them without the snippet engine's
  re-indentation (VS Code's `insertSnippet` doesn't re-indent placeholder text,
  Monaco's does). `snippetToPlainText` now reads escaped `\}`, `\$` and `\\`
  inside placeholders, and `environmentSnippet` resolves `$TM_SELECTED_TEXT`.

### Patch Changes

- Updated dependencies [fb4e72b]
- Updated dependencies [20fd35a]
  - @pretextbook/completions@0.5.0

## 0.2.0

### Minor Changes

- 25275fa: Markdown-style shortcuts: `*em*`, `**alert**`, `` `c` ``, `_term_` and `"q"` inline markup, `[text](url)` links, `--`/`---`/`...` to `<ndash/>`/`<mdash/>`/`<ellipsis/>`, `@` for an `<xref>` with id completions (new `suggest` flag on `ShortcutEdit`), and ` ```lang ` + Enter for `<program>`/`<pre>`/`<cd>`, and Markdown list markers (`- `, `1. `, `(a) `, …) to start an `<ul>`/`<ol>` or the next `<li>`. Each has an option (`inlineMarkup`, `typography`, `crossReferences`, `codeBlocks`, `lists`). A double Enter or Shift+Enter in a list item's text now turns it into paragraphs, and Shift+Enter between an item's paragraphs starts a new one. Closing characters typed over an auto-closed one now count as typing.

## 0.1.0

### Minor Changes

- 1177f49: New package: editor-agnostic PreTeXt typing shortcuts (`$x$` → `<m>x</m>`, `$$x$$` → `<md>x</md>`, escaping a bare `<`/`>`/`&` as `&lt;`/`&gt;`/`&amp;` or `\lt`/`\gt` in math, double Enter or Shift+Enter to start a new paragraph, and `theorem:` + Enter to insert an environment snippet), with a Monaco adapter (`registerMonacoTypingShortcuts`).

### Patch Changes

- Updated dependencies [1177f49]
  - @pretextbook/completions@0.4.0
