# @pretextbook/format

## 0.6.2

### Patch Changes

- a3a4000: Stop the formatter from changing document content:

  - Preserve whitespace at inline element boundaries: no space is added where the source has none (`(<m>x</m>)`, `<m>x</m>'s`, `a<mdash/>b`), and none is removed before a spaced hyphen (`<m>x</m> - y`). Closing brackets after display math stay on the closing tag's line.
  - Keep processing instructions (including `<?xml-model?>` after the XML declaration) and CDATA sections, which were deleted in several positions. Processing instructions between blocks are now indented.
  - Keep consecutive top-level comments on their own lines instead of merging them.
  - Flow text mixed with markup as prose in elements with no dedicated layout, such as a raw `<biblio>`, `<intertext>`, and `<feedback>`, rather than splitting it at every tag. Files laid out that way by earlier versions are repaired.

## 0.6.1

### Patch Changes

- e0171c1: Regenerate schema artifacts from the updated `pretext.rng`, which added
  bibliography fields such as `archive_location`, `chapter-number`,
  `collection-number`, `container-title-short`, `number-of-volumes` and `version`.
  The formatter keeps the new text-only fields on one line with their tags.

## 0.6.0

### Minor Changes

- 8ce5bb2: Add support for slideshow elements to formatter

## 0.5.0

### Minor Changes

- e2b6d96: Improved import features

## 0.4.0

### Minor Changes

- 6678cc6: Improvements to import and live preview features

## 0.3.0

### Minor Changes

- 598ccbc: Misc improvements

## 0.2.1

### Patch Changes

- dc17330: Schema and formatting improvements

## 0.2.0

### Minor Changes

- 2f5b5e2: Improve verbatim; add option to break long lists of attributes

## 0.1.0

### Minor Changes

- f4235b7: Update formatter
