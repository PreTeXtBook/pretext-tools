---
"@pretextbook/typing-shortcuts": minor
---

Wrap a selection by typing over it: `$`, `*`, `` ` `` and `"` wrap it in
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
