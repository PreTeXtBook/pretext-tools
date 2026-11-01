# @pretextbook/ptxast-util-to-mdast

## 0.1.0

### Minor Changes

- be5549b: Headings take attributes the way directives do: `## My Title {#sec-a label="x"}` sets the division's `xml:id` and `label`, instead of leaving the braces in the title. A link to an id is now a cross-reference, so `[](#sec-a)` becomes `<xref ref="sec-a"/>` and `[text](#sec-a)` becomes `<xref ref="sec-a">text</xref>`.

  Converting PreTeXt back to Markdown writes both forms too. An `<xref>` that Markdown can't express (`text=`, `first`/`last`, a list of ids) is still dropped.

  Inline directives (`:name[...]`) are no longer parsed, since nothing used them, so a colon in prose like `f:X` stays text rather than becoming a `<TODO>`.

## 0.0.10

### Patch Changes

- Updated dependencies [6678cc6]
  - @pretextbook/ptxast@0.2.0

## 0.0.9

### Patch Changes

- Updated dependencies [876c474]
  - @pretextbook/ptxast@0.1.0

## 0.0.8

### Patch Changes

- Updated dependencies [dc17330]
  - @pretextbook/ptxast@0.0.8

## 0.0.7

### Patch Changes

- c98a799: Fix root division frontmatter; convert leaf node directives to plus:type includes
- Updated dependencies [c98a799]
  - @pretextbook/ptxast@0.0.7

## 0.0.6

### Patch Changes

- ca9800d: More robust frontmatter for markdown divisions
- Updated dependencies [ca9800d]
  - @pretextbook/ptxast@0.0.6

## 0.0.5

### Patch Changes

- 9fceb62: Add level-aware division conversion for markdown
- Updated dependencies [9fceb62]
  - @pretextbook/ptxast@0.0.5
