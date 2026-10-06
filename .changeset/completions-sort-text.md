---
"@pretextbook/completions": patch
---

Rank curated element snippets ahead of generic schema elements.

Curated elements (`<q>`, `<md>`) carried their bare name as `sortText`, while
generic schema-only elements carried none. Editors fill a missing `sortText`
with the label, so a generic element sorted on `<quantity` against the
curated `q`, and `<` sorts before every letter. Whenever the typed prefix
matched both equally well, every generic element outranked every curated one:
`<q` offered `<quantity` before `<q>`, and `<md` offered `<mdash` before
`<md>`.

Generic elements now use their bare name as `sortText` too, and the extra
element snippets fall back to their alias, so all element completions share one
sort space. A name now sorts ahead of longer names that start with it, and a
curated `sortText` (e.g. `"0"` for `<p>`) works as a priority setting.
