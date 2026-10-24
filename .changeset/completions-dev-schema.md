---
"@pretextbook/completions": patch
"@pretextbook/ptxast": patch
"@pretextbook/import": patch
"@pretextbook/latex-style-pretext": patch
---

Generate the bundled completion schema from the development grammar, as its name and the README already said.

- `defaultDevSchema` was generated from the stable `pretext.rng`, so completions without an explicit `schema` never offered `<choices>`, `<blocks>`, `<cardsort>`, `<matching>`, `<areas>` or the other interactive exercise elements. It now comes from `pretext-dev.rng`, the grammar the package's `prebuild` already fetches. The new map is a strict superset of the old one (408 elements, up from 356); nothing was removed.
- `@pretextbook/ptxast`'s generated element/attribute tables come from the same script, so they now match the development grammar too, as its generated interfaces already did.
- `@pretextbook/import` treats `<area>` and `<eval>` as paragraph content when placing pasted markup, since the development grammar allows both inside `<p>`.
- `@pretextbook/latex-style-pretext` now curates two things the converter already supported, which the converter-support probe found once it ran over the development grammar's element names: `\address` (folded into the preceding `\author`'s record, like `\email`) and beamer's `block`/`alertblock` environments (converted to `<assemblage>`, with the braced argument as the title).
