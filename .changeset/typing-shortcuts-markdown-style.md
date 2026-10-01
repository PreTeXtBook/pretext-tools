---
"@pretextbook/typing-shortcuts": minor
---

Markdown-style shortcuts: `*em*`, `**alert**`, `` `c` ``, `_term_` and `"q"` inline markup, `[text](url)` links, `--`/`---`/`...` to `<ndash/>`/`<mdash/>`/`<ellipsis/>`, `@` for an `<xref>` with id completions (new `suggest` flag on `ShortcutEdit`), and ` ```lang ` + Enter for `<program>`/`<pre>`/`<cd>`, and Markdown list markers (`- `, `1. `, `(a) `, …) to start an `<ul>`/`<ol>` or the next `<li>`. Each has an option (`inlineMarkup`, `typography`, `crossReferences`, `codeBlocks`, `lists`). A double Enter or Shift+Enter in a list item's text now turns it into paragraphs, and Shift+Enter between an item's paragraphs starts a new one. Closing characters typed over an auto-closed one now count as typing.
