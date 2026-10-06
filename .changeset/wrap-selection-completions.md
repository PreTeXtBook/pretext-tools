---
"@pretextbook/completions": minor
---

Complete the name of a start tag that is already complete, like the `<|>`
that wrapping a selection in an element leaves: the items are bare element
names allowed there, and their edit covers just the name, so a mirrored end
tag gets the same edit.

The snippets for `<p>`, `<blockquote>`, `<li>`, `<fn>`, `<md>`/`<me>`,
`<title>` and `<url>` now mark where a selection goes with
`$TM_SELECTED_TEXT`, which the typing shortcuts use to wrap a selection in
them. With nothing selected they insert what they did before.
