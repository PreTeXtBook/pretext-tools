# @pretextbook/import

## 0.13.0

### Minor Changes

- 1ca655a: Wrap pasted text in `<p>` when it lands outside a paragraph.

  `unified-latex` wraps paragraphs only when the LaTeX it is given has more than one of them, so the commonest paste there is — a single paragraph of prose — arrived as bare text with no `<p>` around it, and `Intro \begin{theorem}…\end{theorem} outro` arrived as text on either side of a block with no paragraph around either. Both are invalid wherever the cursor is not already inside a `<p>`.

  `placeConvertedMarkup` now supplies the missing paragraphs on the block-context path, and the new `wrapLooseParagraphs` export does it for hosts that want the pass on its own. It follows the schema's rule rather than a hand-written list of tags: a top-level element the `<p>` content model admits joins the paragraph being accumulated — `<m>` and `<em>`, and equally `<md>` and `<ol>`, which belong inside a paragraph — while one it does not, such as `<theorem>`, `<pre>`, or a division, ends the run and passes through untouched. Markup that already has its paragraphs is unchanged.

  Two fixes on the inline path, where the insertion point is inside a `<p>`. Unwrapping the converter's own `<p>` used a regex that would "unwrap" `<p>A</p><p>B</p>` into `A</p><p>B`; several paragraphs are now left intact with a warning instead. And the warning about content that cannot sit inside a paragraph covers every block element rather than only divisions, so a pasted `<theorem>` or `<pre>` is reported too — while a nested `<p>`, inside an `<li>` of a legal `<ol>`, no longer trips it.

## 0.12.0

### Minor Changes

- 4c33215: Route imports to a converter by file extension instead of asking the author to pick one.

  The wizard's converter radio group is gone. The file picker now accepts every format any registered engine reads, and the upload is routed by its extension: a `.docx` goes to pandoc and a `.zip` project goes to the built-in converter without the author having to know which is which. A file nothing reads gets a message naming the supported types instead of silently doing nothing.

  The manual override moved to the review step, where the author can see the result it applies to. It appears only when the file that was actually loaded has a second converter that could read it — for a Word file or a zipped project there is nothing to switch to, so nothing is offered — and toggling it re-runs the import through the other converter. The error step offers the same switch as a button.

  `ImportEngine.label` and `description` now surface in that override and in error messages rather than in a menu; engine order is precedence, so list the engine that should own a shared format first. New `lib/engine-routing` helpers (`routeEngine`, `alternateFor`, `allAcceptExtensions`, `alternateEngine`, `unsupportedFileMessage`) are exported for hosts that need the same routing outside the wizard.

## 0.11.0

### Minor Changes

- bccaf34: Export the paste placement helpers (`placeConvertedMarkup`, `isInlineContext`, `reindentForContext`, `firstDivisionTag`), moved here from the VS Code extension so every host fits converted markup to the cursor the same way.

### Patch Changes

- bccaf34: Move some code around to make integrating in pretext-plus easier
- bccaf34: Pin the internal `@pretextbook/*` dependencies to real ranges instead of `*`. Changesets deliberately leaves a `*` range alone, so published versions of this package never asked npm for a newer `format`, `latex-pretext`, `latex-style-pretext` or `remark-pretext` — any copy already in a consumer's tree satisfied the range and stayed there.
- Updated dependencies [bccaf34]
  - @pretextbook/latex-style-pretext@0.5.1
  - @pretextbook/latex-pretext@0.3.1

## 0.10.0

### Minor Changes

- e2b6d96: Improved import features

### Patch Changes

- Updated dependencies [e2b6d96]
  - @pretextbook/format@0.5.0

## 0.9.0

### Minor Changes

- f365fe0: Expose import type

## 0.8.0

### Minor Changes

- 9543e76: Many minor improvements to conversion and import

### Patch Changes

- Updated dependencies [9543e76]
  - @pretextbook/latex-style-pretext@0.5.0
  - @pretextbook/remark-pretext@0.1.0
  - @pretextbook/latex-pretext@0.3.0

## 0.7.0

### Minor Changes

- 4dbef28: Improve visual feedback when importing

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
