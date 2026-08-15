---
"@pretextbook/latex-style-pretext": minor
"@pretextbook/import": minor
---

Share the LaTeX cleaning rules between the importer and the editor, and split large LaTeX documents properly.

**`@pretextbook/latex-style-pretext`** gains a `clean/` module: the legacy-LaTeX cleaning rules (ported from the importer, which ported them from PreprocessLaTeX) now live here as a single rule table, and report _positioned_ fixes rather than a rewritten string plus occurrence counts. That makes the same rules available three ways — `findLatexFixes` for diagnostics, `latexFixesToCodeActions` for per-occurrence quick fixes and a whole-file "Clean up LaTeX" action, and `cleanLatexText` for the importer's bulk pass. Matching now runs through the existing document scanner, so rules no longer fire inside `verbatim` bodies, code listings, or comments.

**`@pretextbook/import`** consumes that engine instead of carrying its own copy. Beyond that:

- The LaTeX splitter understands the whole sectioning hierarchy (`\part` through `\subsubsection`) at any depth, rather than the previous chapter-then-section special case, and honours `splitLevel` the way the PreTeXt splitter always has. Header scanning is now linear rather than quadratic in document size.
- `suggestSplitLevel` picks a default depth from the document's size and shape, so a large article with many sections no longer imports as one enormous file.
- Cleaning is partitioned at division boundaries (`cleanLatexInChunks`), so every generated file carries its own before/after text and fix list — surfaced as `cleanChunks` on the result and joined to files by `fileChangesForImport`.
- New `relayoutImport(result, splitLevel)` re-derives the file layout from an already-converted result without re-running the conversion.
- The import wizard moves the split control to the review step as a depth chooser, shows the resulting file tree live as the depth changes, and offers a before/after diff per file.
