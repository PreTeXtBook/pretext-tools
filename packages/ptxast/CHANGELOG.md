# @pretextbook/ptxast

## 0.2.3

### Patch Changes

- b492420: Generate the bundled completion schema from the development grammar, as its name and the README already said.

  - `defaultDevSchema` was generated from the stable `pretext.rng`, so completions without an explicit `schema` never offered `<choices>`, `<blocks>`, `<cardsort>`, `<matching>`, `<areas>` or the other interactive exercise elements. It now comes from `pretext-dev.rng`, the grammar the package's `prebuild` already fetches. The new map is a strict superset of the old one (408 elements, up from 356); nothing was removed.
  - `@pretextbook/ptxast`'s generated element/attribute tables come from the same script, so they now match the development grammar too, as its generated interfaces already did.
  - `@pretextbook/import` treats `<area>` and `<eval>` as paragraph content when placing pasted markup, since the development grammar allows both inside `<p>`.
  - `@pretextbook/latex-style-pretext` now curates two things the converter already supported, which the converter-support probe found once it ran over the development grammar's element names: `\address` (folded into the preceding `\author`'s record, like `\email`) and beamer's `block`/`alertblock` environments (converted to `<assemblage>`, with the braced argument as the title).

## 0.2.2

### Patch Changes

- e0171c1: Regenerate schema artifacts from the updated `pretext.rng`, which added
  bibliography fields such as `archive_location`, `chapter-number`,
  `collection-number`, `container-title-short`, `number-of-volumes` and `version`.
  The formatter keeps the new text-only fields on one line with their tags.

## 0.2.1

### Patch Changes

- 1f8e8f7: Sync PreTeXt schemas and XSL to pretext-cli v2.55.0 (core commit ee0a7e1).

## 0.2.0

### Minor Changes

- 6678cc6: Improvements to import and live preview features

## 0.1.0

### Minor Changes

- 876c474: Updates to pretext, improvements to latex-style linting, and preview of runestone components

## 0.0.8

### Patch Changes

- dc17330: Schema and formatting improvements

## 0.0.7

### Patch Changes

- c98a799: Fix root division frontmatter; convert leaf node directives to plus:type includes

## 0.0.6

### Patch Changes

- ca9800d: More robust frontmatter for markdown divisions

## 0.0.5

### Patch Changes

- 9fceb62: Add level-aware division conversion for markdown
