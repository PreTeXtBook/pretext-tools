# @pretextbook/remark-pretext

## 0.4.0

### Minor Changes

- ee6b86d: Markdown-style PreTeXt now has tables. A GFM pipe table converts to a `<tabular>` (header row → `<row header="yes">`, column alignment → `halign` on the `<tabular>` or its `<col>`s), and `:::table[Title]{#id}` around one gives a titled `<table>`. Going back to Markdown, a `<tabular>` becomes a pipe table when nothing would be lost, and is kept as raw PreTeXt otherwise (borders, widths, `colspan`, block content in cells); a `<table>` becomes `:::table`. Editor support completes `:::table` with a title and table skeleton and accepts it in lint. Only the table extension of GFM is enabled.

## 0.3.0

### Minor Changes

- be5549b: Headings take attributes the way directives do: `## My Title {#sec-a label="x"}` sets the division's `xml:id` and `label`, instead of leaving the braces in the title. A link to an id is now a cross-reference, so `[](#sec-a)` becomes `<xref ref="sec-a"/>` and `[text](#sec-a)` becomes `<xref ref="sec-a">text</xref>`.

  Converting PreTeXt back to Markdown writes both forms too. An `<xref>` that Markdown can't express (`text=`, `first`/`last`, a list of ids) is still dropped.

  Inline directives (`:name[...]`) are no longer parsed, since nothing used them, so a colon in prose like `f:X` stays text rather than becoming a `<TODO>`.

- 0426a2b: Raw PreTeXt in Markdown now converts to real elements instead of `<TODO>` placeholders. Tags in running text (`<xref ref="a"/>`, `<url href="...">text</url>`, `<fn>...</fn>`) keep Markdown working between them, while a block (`<figure>`, `<program>`) stays PreTeXt through to its closing tag, even past blank lines. Comments are dropped. Tags that don't balance, don't parse, or aren't PreTeXt (`<br>`, `<div>`) are still flagged with a `<TODO>`.

  Math now works everywhere inline content does: headings, emphasis, and link text no longer leak a `PTX_MATH_TOKEN` placeholder, and neither does `$$x$$2`. Display math where it isn't allowed (titles, emphasis, link text) becomes `<m>`. A `$` in a directive attribute or a `~~~` block stays as written.

  Frontmatter `title:` and the `topLevelTitle` option are now read as inline Markdown, so they support math, emphasis, code and raw tags like any other title. `1. Intro` stays a plain title.

### Patch Changes

- 4344fc4: Stop treating dollar amounts as math. `$...$` is now math only when it closes on the same line, has no space just inside its delimiters, and isn't attached to a letter or digit on the outside, so `$2 to $5`, `$5-$10` and a `$` in a URL stay text, and `\$` is always a literal dollar sign. Text between two dollar signs is no longer lost, even across paragraphs. `$$...$$`, `\(...\)` and `\[...\]` are unchanged.

  Math written against a word (`the $n$th term`, `90$^\circ$`), padded with spaces (`$ x $`), or wrapped onto a second line now stays text.

## 0.2.0

### Minor Changes

- 82fd786: Add support for importing slides

## 0.1.0

### Minor Changes

- 9543e76: Many minor improvements to conversion and import

## 0.0.13

### Patch Changes

- Updated dependencies [6678cc6]
  - @pretextbook/ptxast@0.2.0

## 0.0.12

### Patch Changes

- Updated dependencies [876c474]
  - @pretextbook/ptxast@0.1.0

## 0.0.11

### Patch Changes

- dc17330: Schema and formatting improvements
- Updated dependencies [dc17330]
  - @pretextbook/ptxast@0.0.8

## 0.0.10

### Patch Changes

- 4acf9c0: Lots of updates

## 0.0.9

### Patch Changes

- 5885a18: Improve markdown and latex conversions to pretext

## 0.0.8

### Patch Changes

- c98a799: Fix root division frontmatter; convert leaf node directives to plus:type includes
- Updated dependencies [c98a799]
  - @pretextbook/ptxast@0.0.7

## 0.0.7

### Patch Changes

- ca9800d: More robust frontmatter for markdown divisions
- Updated dependencies [ca9800d]
  - @pretextbook/ptxast@0.0.6

## 0.0.6

### Patch Changes

- 9fceb62: Add level-aware division conversion for markdown
- Updated dependencies [9fceb62]
  - @pretextbook/ptxast@0.0.5

## 0.0.5

### Patch Changes

- 5f68092: Syntax highlighting for markdown-style pretext
