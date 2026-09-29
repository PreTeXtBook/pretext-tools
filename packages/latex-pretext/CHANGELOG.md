# @pretextbook/latex-pretext

## 0.4.0

### Minor Changes

- 818bd67: Improve beamer slide imports: the title frame becomes the slideshow's `<frontmatter>` title slide (title, subtitle, every author with their institute, date), `\pause` and incremental lists become PreTeXt pauses, beamer overlay specifications are no longer mangled into `\lt`/`\gt`, and outline frames are dropped instead of left as empty slides. `latexToPretext` gains a `fragment: false` option that returns a whole document. The LaTeX macro table now knows beamer's `\institute`, `\inst`, `\titlegraphic`, `\titlepage` and `\note`, and reads an overlay spec such as `\alert<2>{...}` as an optional argument.

## 0.3.1

### Patch Changes

- bccaf34: Move some code around to make integrating in pretext-plus easier

## 0.3.0

### Minor Changes

- 9543e76: Many minor improvements to conversion and import

## 0.2.0

### Minor Changes

- 7749353: Improve latex support

## 0.1.0

### Minor Changes

- 6940e14: Improve import and add clean function

## 0.0.16

### Patch Changes

- 82ef8b2: add bibtex to latex-to-pretext

## 0.0.15

### Patch Changes

- d537383: Updates to latex-to-pretext

## 0.0.13

### Patch Changes

- dc17330: Schema and formatting improvements

## 0.0.12

### Patch Changes

- 4acf9c0: Lots of updates

## 0.0.11

### Patch Changes

- 5885a18: Improve markdown and latex conversions to pretext
