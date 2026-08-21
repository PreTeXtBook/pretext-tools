# @pretextbook/latex-style-pretext

## 0.5.0

### Minor Changes

- 9543e76: Many minor improvements to conversion and import

## 0.4.0

### Minor Changes

- 7749353: Improve latex support

## 0.3.0

### Minor Changes

- 40dd00b: Resync the curated LaTeX-style PreTeXt tables with the converter, guard them against future drift, and offer semantic replacements for presentational font macros.

  **The tables had gone stale, and the drift guard could not see it.** `packages/latex-style-pretext` was resolving `@pretextbook/latex-pretext` to a stale copy of the published `0.0.13` pinned in `package-lock.json`, rather than to the workspace package — so the existing drift spec was checking against converter `0.0.4` while the workspace had moved on. Removing that pin (and declaring `@pretextbook/unified-latex-to-pretext` as a devDependency, which the refresh script needs) puts the package on converter `0.0.8`.

  What that surfaced, now added: ten PreTeXt division macros (`\preface`, `\worksheet`, `\exercises`, `\solutions`, `\glossary`, `\handout`, `\biography`, `\dedication`, `\paragraphs`, `\readingquestions`), plus `\alert`, `\citep`, `\email`, `\keywords`, `\subjclass`, and the `description` environment. `\foreignlanguage` takes `{language}{text}`, not one argument. `gi`, `sbsgroup`, `stack` and `webwork` do accept a `[title]`. And `\centering`, `\newline`, `\maketitle` and `\tableofcontents` are converted upstream now, so they no longer count as unsupported.

  **Keeping it in sync from here.** `npm run refresh:latex-support` regenerates `src/data/converter-support.json` from the installed converter; `npm run check:latex-support` fails when it is stale, and CI runs it. A new `converter-coverage.spec.ts` checks the direction the old guard never did — that the tables cover everything the converter supports — naming each missing entry. Because the converter exports only half its surface, the snapshot also records what it will convert when probed with every PreTeXt element name from the schema; that half is how `\alert` was found.

  **Quick fixes for presentational font macros.** `\textbf` and friends are flagged rather than rewritten, because only the author knows whether bold meant a warning, a defined term, ordinary emphasis, or nothing at all. The editor now offers the whole choice, least destructive first:

  - **Replace with a semantic macro** — `\alert`, `\term`, `\emph` for `\textbf`; `\emph`, `\term`, `\foreign`, `\alert` for `\textit`; `\code`/`\kbd` for `\texttt`; `\init`/`\acro`/`\term` for `\textsc`.
  - **Remove the macro, keep its text** — `\textbf{bold words}` becomes `bold words`.
  - **Delete the macro and its text** — the whole call goes.

  Each has an "all N occurrences" twin once the macro appears more than once, the way a spell checker offers both "Change" and "Change All". "All" is scoped to that one macro, so fixing `\textbf` leaves `\textit` alone. Removal spans are computed per occurrence against the macro's curated signature, so a one-word `\textbf` and a whole-sentence one are both handled correctly in a single sweep, and `\textbf{a}{b}` does not swallow the trailing group.

  All of these are deliberately excluded from the bulk "Clean up LaTeX" action and from the importer's cleaning pass: choosing among them is an editorial decision, not a defect to repair.

- 40dd00b: Improve cleaning of suspect latex

## 0.2.0

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

## 0.1.1

### Patch Changes

- d537383: Updates to latex-to-pretext

## 0.1.0

### Minor Changes

- 876c474: Updates to pretext, improvements to latex-style linting, and preview of runestone components

## 0.0.2

### Patch Changes

- ccb0deb: Add banner message for live preview, update validations and completions"
