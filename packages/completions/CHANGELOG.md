# @pretextbook/completions

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
