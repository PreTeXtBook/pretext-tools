# @pretextbook/markdown-style-pretext

## 0.2.0

### Minor Changes

- ee6b86d: Markdown-style PreTeXt now has tables. A GFM pipe table converts to a `<tabular>` (header row → `<row header="yes">`, column alignment → `halign` on the `<tabular>` or its `<col>`s), and `:::table[Title]{#id}` around one gives a titled `<table>`. Going back to Markdown, a `<tabular>` becomes a pipe table when nothing would be lost, and is kept as raw PreTeXt otherwise (borders, widths, `colspan`, block content in cells); a `<table>` becomes `:::table`. Editor support completes `:::table` with a title and table skeleton and accepts it in lint. Only the table extension of GFM is enabled.

## 0.1.5

### Patch Changes

- Updated dependencies [38cfd1c]
  - @pretextbook/latex-style-pretext@0.6.0

## 0.1.4

### Patch Changes

- Updated dependencies [9543e76]
  - @pretextbook/latex-style-pretext@0.5.0

## 0.1.3

### Patch Changes

- Updated dependencies [7749353]
  - @pretextbook/latex-style-pretext@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [40dd00b]
- Updated dependencies [40dd00b]
  - @pretextbook/latex-style-pretext@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [6940e14]
- Updated dependencies [6940e14]
  - @pretextbook/latex-style-pretext@0.2.0

## 0.1.0

### Minor Changes

- 876c474: Updates to pretext, improvements to latex-style linting, and preview of runestone components

### Patch Changes

- Updated dependencies [876c474]
  - @pretextbook/latex-style-pretext@0.1.0

## 0.0.2

### Patch Changes

- Updated dependencies [ccb0deb]
  - @pretextbook/latex-style-pretext@0.0.2
