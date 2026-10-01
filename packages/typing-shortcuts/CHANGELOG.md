# @pretextbook/typing-shortcuts

## 0.2.0

### Minor Changes

- 25275fa: Markdown-style shortcuts: `*em*`, `**alert**`, `` `c` ``, `_term_` and `"q"` inline markup, `[text](url)` links, `--`/`---`/`...` to `<ndash/>`/`<mdash/>`/`<ellipsis/>`, `@` for an `<xref>` with id completions (new `suggest` flag on `ShortcutEdit`), and ` ```lang ` + Enter for `<program>`/`<pre>`/`<cd>`, and Markdown list markers (`- `, `1. `, `(a) `, …) to start an `<ul>`/`<ol>` or the next `<li>`. Each has an option (`inlineMarkup`, `typography`, `crossReferences`, `codeBlocks`, `lists`). A double Enter or Shift+Enter in a list item's text now turns it into paragraphs, and Shift+Enter between an item's paragraphs starts a new one. Closing characters typed over an auto-closed one now count as typing.

## 0.1.0

### Minor Changes

- 1177f49: New package: editor-agnostic PreTeXt typing shortcuts (`$x$` → `<m>x</m>`, `$$x$$` → `<md>x</md>`, escaping a bare `<`/`>`/`&` as `&lt;`/`&gt;`/`&amp;` or `\lt`/`\gt` in math, double Enter or Shift+Enter to start a new paragraph, and `theorem:` + Enter to insert an environment snippet), with a Monaco adapter (`registerMonacoTypingShortcuts`).

### Patch Changes

- Updated dependencies [1177f49]
  - @pretextbook/completions@0.4.0
