# @pretextbook/import

## 0.6.0

### Minor Changes

- 6940e14: Improve import and add clean function
- 6940e14: Share the LaTeX cleaning rules between the importer and the editor, and split large LaTeX documents properly.

  **`@pretextbook/latex-style-pretext`** gains a `clean/` module: the legacy-LaTeX cleaning rules (ported from the importer, which ported them from PreprocessLaTeX) now live here as a single rule table, and report _positioned_ fixes rather than a rewritten string plus occurrence counts. That makes the same rules available three ways — `findLatexFixes` for diagnostics, `latexFixesToCodeActions` for per-occurrence quick fixes and a whole-file "Clean up LaTeX" action, and `cleanLatexText` for the importer's bulk pass. Matching now runs through the existing document scanner, so rules no longer fire inside `verbatim` bodies, code listings, or comments.

  **`@pretextbook/import`** consumes that engine instead of carrying its own copy. Beyond that:

  - The LaTeX splitter understands the whole sectioning hierarchy (`\part` through `\subsubsection`) at any depth, rather than the previous chapter-then-section special case, and honours `splitLevel` the way the PreTeXt splitter always has. Header scanning is now linear rather than quadratic in document size.
  - `suggestSplitLevel` picks a default depth from the document's size and shape, so a large article with many sections no longer imports as one enormous file.
  - Cleaning is partitioned at division boundaries (`cleanLatexInChunks`), so every generated file carries its own before/after text and fix list — surfaced as `cleanChunks` on the result and joined to files by `fileChangesForImport`.
  - New `relayoutImport(result, splitLevel)` re-derives the file layout from an already-converted result without re-running the conversion.
  - The import wizard moves the split control to the review step as a depth chooser, shows the resulting file tree live as the depth changes, and offers a before/after diff per file.

### Patch Changes

- Updated dependencies [6940e14]
- Updated dependencies [6940e14]
  - @pretextbook/latex-style-pretext@0.2.0
  - @pretextbook/latex-pretext@0.1.0

## 0.5.0

### Minor Changes

- f179033: Tweaks to make pretext.plus happy

## 0.4.0

### Minor Changes

- 6678cc6: Improvements to import and live preview features

### Patch Changes

- Updated dependencies [6678cc6]
  - @pretextbook/format@0.4.0
  - @pretextbook/remark-pretext@0.0.13

## 0.3.0

### Minor Changes

- b3a898f: Add support for native imports in pretext plus

## 0.1.0

### Minor Changes

- 598ccbc: Misc improvements

### Patch Changes

- Updated dependencies [598ccbc]
  - @pretextbook/format@0.3.0
