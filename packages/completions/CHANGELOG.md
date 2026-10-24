# @pretextbook/completions

## 0.5.3

### Patch Changes

- b492420: Generate the bundled completion schema from the development grammar, as its name and the README already said.

  - `defaultDevSchema` was generated from the stable `pretext.rng`, so completions without an explicit `schema` never offered `<choices>`, `<blocks>`, `<cardsort>`, `<matching>`, `<areas>` or the other interactive exercise elements. It now comes from `pretext-dev.rng`, the grammar the package's `prebuild` already fetches. The new map is a strict superset of the old one (408 elements, up from 356); nothing was removed.
  - `@pretextbook/ptxast`'s generated element/attribute tables come from the same script, so they now match the development grammar too, as its generated interfaces already did.
  - `@pretextbook/import` treats `<area>` and `<eval>` as paragraph content when placing pasted markup, since the development grammar allows both inside `<p>`.
  - `@pretextbook/latex-style-pretext` now curates two things the converter already supported, which the converter-support probe found once it ran over the development grammar's element names: `\address` (folded into the preceding `\author`'s record, like `\email`) and beamer's `block`/`alertblock` environments (converted to `<assemblage>`, with the braced argument as the title).

## 0.5.2

### Patch Changes

- daf7fc4: Fix bug that prevented completions when cursor is in column 0

## 0.5.1

### Patch Changes

- e0171c1: Regenerate schema artifacts from the updated `pretext.rng`, which added
  bibliography fields such as `archive_location`, `chapter-number`,
  `collection-number`, `container-title-short`, `number-of-volumes` and `version`.
  The formatter keeps the new text-only fields on one line with their tags.

## 0.5.0

### Minor Changes

- 20fd35a: Complete the name of a start tag that is already complete, like the `<|>`
  that wrapping a selection in an element leaves: the items are bare element
  names allowed there, and their edit covers just the name, so a mirrored end
  tag gets the same edit.

  The snippets for `<p>`, `<blockquote>`, `<li>`, `<fn>`, `<md>`/`<me>`,
  `<title>` and `<url>` now mark where a selection goes with
  `$TM_SELECTED_TEXT`, which the typing shortcuts use to wrap a selection in
  them. With nothing selected they insert what they did before.

### Patch Changes

- fb4e72b: Rank curated element snippets ahead of generic schema elements.

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

## 0.4.1

### Patch Changes

- 1f8e8f7: Sync PreTeXt schemas and XSL to pretext-cli v2.55.0 (core commit ee0a7e1).

## 0.4.0

### Minor Changes

- 1177f49: Export the element snippet table as `ELEMENTS`, and depend on the side-effect-free `vscode-languageserver-types` instead of `vscode-languageserver`, so the package no longer pulls language-server runtime code into browser or extension-host bundles.

## 0.3.0

### Minor Changes

- 6678cc6: Improvements to import and live preview features

## 0.2.0

### Minor Changes

- 876c474: Updates to pretext, improvements to latex-style linting, and preview of runestone components

## 0.1.0

### Minor Changes

- 598ccbc: Misc improvements

## 0.0.4

### Patch Changes

- dc17330: Schema and formatting improvements
