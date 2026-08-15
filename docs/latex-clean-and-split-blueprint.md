# Blueprint: LaTeX cleaning as a shared engine, and split-aware import

> **Status: implemented.** All six phases landed. Where the built code diverges
> from the original design, the section says so and gives the reason — see
> "Cheap re-layout" and "Size-aware default depth" under Better splitting.

Two features that turn out to be one refactor:

1. **Better splitting** of large LaTeX documents into per-division files, with the import wizard
   showing a live file tree as split depth changes and a before/after diff per file.
2. **"Fix my LaTeX"** as an editor feature — the same cleaning rules, offered as diagnostics and
   quick fixes (plus a bulk command) in the pretext-plus Monaco editor first, the VS Code
   extension after.

## Decisions already made

| Decision              | Choice                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Rule home             | New `clean/` module inside `@pretextbook/latex-style-pretext`, beside `lint/`                      |
| Editor UX             | Both: per-occurrence diagnostics + quick fixes, **and** a bulk "Clean up" command, from one engine |
| Cleaning scope        | Always **one file/division at a time** — the importer calls it per split unit                      |
| Attribution           | Free, by construction: clean _after_ splitting, so a fix is in the file it was handed              |
| Wizard "what changed" | Before/after diff per generated file + live file tree as split depth changes                       |
| First host            | pretext-plus (Monaco); VS Code extension follows on the same `PretextFlavorLanguage` contract      |

## Why one refactor covers both

Today's cleaner is `(string) → { output: string, warnings: CleaningWarning[] }`
([`clean-latex.ts`](../packages/import/src/lib/clean/clean-latex.ts)), where every rule is a global
`String.replace` and `CleaningWarning` carries a macro name and an occurrence count but **no
position** ([`warnings.ts`](../packages/import/src/lib/clean/warnings.ts)).

That single shape blocks both features. Without positions there is nothing to attach a squiggle
to, nothing to build a `TextEdit` from, and nothing to diff. The fix is to make the cleaner report
_positioned fixes_ and make _applying_ them a separate step:

```
findLatexFixes(text, opts) → LatexFix[]        ← pure, positioned, no mutation
         │
         ├─▶ latexFixesToDiagnostics()  → squiggles in Monaco / VS Code
         ├─▶ latexFixesToCodeActions()  → per-occurrence quick fixes
         ├─▶ applyLatexFixes(text, all) → bulk "Clean up" command
         └─▶ applyLatexFixes(text, all) → the import pipeline's cleanLatex()
```

The import pipeline and the editor become the same call with different consumers of the result.

### A correctness bonus

The current rules are raw regexes over the whole document, so `{\bf x}` inside
`\begin{verbatim}` is silently rewritten and `\vspace` in a code listing is silently deleted.
`latex-style-pretext` already has [`scanDocument`](../packages/latex-style-pretext/src/scan/scan-document.ts),
which tracks math regions, comment regions, and verbatim environments. Running rules through the
scanner fixes this class of bug as a side effect of the move.

## Architecture

```
              ┌──────────────────────────────────────────────────┐
              │  @pretextbook/latex-style-pretext                │
              │    scan/    mode + verbatim + comment aware      │
              │    data/    curated env + macro specs            │
              │    lint/    getLatexDiagnostics  (parse-level)   │
              │    clean/   NEW — rules, findFixes, applyFixes   │
              └────┬──────────────────┬────────────────┬─────────┘
                   │                  │                │
      @pretextbook/import      VS Code LSP server   pretext-plus
      (cleans per division)    (diagnostics +       (Monaco: same,
                                code actions)        first host)
```

`latex-style-pretext` is the right home: it already ships raw TypeScript with no build step, its
only runtime dependency is `vscode-languageserver-types` (browser-safe), and both hosts already
consume it through [`flavor-languages.ts`](../packages/vscode-extension/src/lsp-server/flavor-languages.ts).
Putting the rules in `@pretextbook/import` instead would drag `jszip`, React, `@pretextbook/format`
and `@pretextbook/latex-pretext` into the Monaco bundle.

The conceptual seam to keep clear: `lint/` answers _"will this convert?"_ about LaTeX-style
PreTeXt; `clean/` answers _"should this still be here?"_ about legacy LaTeX. Different questions,
shared scanner, no dependency between them. Hosts merge the two diagnostic streams and can toggle
them independently via `source`.

## The `clean/` module

### `clean/rules.ts` — the rule table

Ported from [`latex-data.ts`](../packages/import/src/lib/clean/latex-data.ts), which today is six
differently-shaped exports (`badEverywhereMacros`, `badEverywhereMacrosLine`,
`badEverywhereMacrosPlus`, `publisherOptions`, `eliminateAndSave`, `badBodyEnvironments`) whose
shape is what decides their behavior, with the dispatch spread across
[`scanForAnomalies`](../packages/import/src/lib/clean/latex-scan.ts). Flatten to one list where
behavior is data:

```ts
export interface CleanRule {
  /** Stable id — used to disable a rule and to key code actions. */
  id: string;
  kind: ErrorKind; // unused | presentation | accessibility | mistake | archaic | publisher | other
  category: string;
  /** Where the rule may fire. */
  scope: "preamble" | "body" | "anywhere";
  match:
    | {
        type: "macro";
        name: string;
        form: "bare" | "line" | "args";
        arity?: number;
      }
    | { type: "environment"; name: string }
    | { type: "regex"; pattern: RegExp };
  action: "delete" | "replace" | "flag" | "save";
  /** For `replace`; `$1`-style references into the match are allowed. */
  replacement?: string;
  severity: "info" | "warning" | "error";
  message?: string;
  /** Suppress inside these scan regions. Defaults to all of them. */
  skipIn?: ("math" | "comment" | "verbatim")[];
}
```

Upstream typo fidelity (`textss`, `testsl` — preserved deliberately per `latex-data.ts`'s header
comment) carries over unchanged, and the existing fidelity tests move with it.

### `clean/find-fixes.ts`

```ts
export interface LatexFix {
  ruleId: string;
  action: "delete" | "replace" | "flag" | "save";
  severity: "info" | "warning" | "error";
  kind: string;
  category: string;
  /** The macro or environment name, for grouping and display. */
  macro: string;
  /** Offsets into the text handed to findLatexFixes. */
  start: number;
  end: number;
  /** The matched source text — for the diff view and for `save` reporting. */
  matched: string;
  /** Replacement text; "" for delete; undefined for flag/save. */
  replacement?: string;
  message?: string;
}

export interface FindFixesOptions {
  /** What `text` is. "auto" detects \begin{document}. Default "auto". */
  scope?: "document" | "preamble" | "body" | "auto";
  /** Rule ids to skip. */
  disable?: string[];
}

export function findLatexFixes(
  text: string,
  options?: FindFixesOptions,
): LatexFix[];
```

`scope` is what lets one engine serve both hosts. The importer hands it a whole document
(`"auto"`, which splits at `\begin{document}` the way
[`separatePieces`](../packages/import/src/lib/clean/latex-scan.ts) does today) or a single division
(`"body"`). The editor hands it whatever the user has open — a pretext-plus division is `"body"`,
a `.tex` file is `"auto"`.

### `clean/apply-fixes.ts`

```ts
export function applyLatexFixes(
  text: string,
  fixes: LatexFix[],
): { output: string; applied: LatexFix[] };
export function latexFixesToTextEdits(
  text: string,
  fixes: LatexFix[],
): TextEdit[];
```

Applies descending by `start` so earlier offsets stay valid; drops any fix overlapping one already
applied. Note this replaces today's "run `fixPlainTeX` twice to catch nesting" hack in
`clean-latex.ts` with an explicit fixpoint loop (find → apply → repeat until stable, capped at ~5
passes), which handles arbitrary nesting instead of exactly two levels.

### `clean/to-diagnostics.ts`

```ts
export function latexFixesToDiagnostics(
  text: string,
  fixes: LatexFix[],
): Diagnostic[];
export function latexFixesToCodeActions(
  text: string,
  fixes: LatexFix[],
  range: Range,
): CodeAction[];
```

Diagnostics carry `source: "pretext-latex-clean"` (distinct from `lint/`'s `"pretext-latex"`) and
`data: { ruleId }` so the code-action handler can rebuild the edit without re-scanning. Each
`flag`/`save` fix produces a diagnostic with no action; each `delete`/`replace` fix produces a
diagnostic plus a quick fix, and the module also emits one "Clean up this file" source action.

### Host contract

`PretextFlavorLanguage` ([`types.ts`](../packages/latex-style-pretext/src/types.ts)) gains one
optional member, so `markdown-style-pretext` is unaffected:

```ts
getCleanFixes?(text: string, options?: FindFixesOptions): LatexFix[];
```

## `@pretextbook/import` after the move

- **Deleted**: `clean/latex-data.ts`, `clean/latex-clean.ts`, `clean/latex-scan.ts`.
- **Kept**: `clean/latex-utils.ts` (`trimJunk` — comment stripping and `\end{document}` trimming
  are import-specific normalization, not editor fixes) and `clean/latex-preamble.ts` (mining
  `\title`/`\author`/`\newcommand` for `<docinfo>` is squarely an import concern).
- **`cleanLatex` becomes a wrapper**: `trimJunk` → `findLatexFixes` → `applyLatexFixes` (fixpoint)
  → map fixes to `CleaningWarning[]` by aggregating on `ruleId`.

`CleanLatexResult` gains the raw fixes without breaking the existing aggregate UI:

```ts
export interface CleanLatexResult {
  output: string;
  warnings: CleaningWarning[]; // unchanged — aggregate, for the existing summary list
  fixes: LatexFix[]; // new — positioned, for the diff view
}
```

## Better splitting

### The problem

There are two splitters that disagree.
[`buildDivisionPool`](../packages/import/src/lib/pool/division-pool.ts) (PreTeXt) is depth-generic
and driven by the full division vocabulary. [`buildNativeDivisionPool`](../packages/import/src/lib/pool/native-pool.ts)
(LaTeX) hardcodes chapter→section, knows nothing of `\part` or `\subsection`, and ignores
`splitLevel` entirely — a limitation SPEC §7 already admits. A large article with thirty
`\section`s gets `splitLevel` 0 and lands in one enormous file.

### Changes

1. **Generalize the LaTeX splitter.** Replace the `findTopLevelLatexDivisions(source, "chapter")` /
   `splitLatexSections` pair with one level-aware walker over `part > chapter > section >
subsection > subsubsection`, recursing to `splitLevel` — the same shape as
   `splitChildDivisions` in `division-pool.ts`. `buildNativeDivisionPool` takes `splitLevel` and
   resolves it through the existing `resolveSplitLevel`.

2. **Size-aware default depth.** New `suggestSplitLevel(source, documentKind)`: go one level
   deeper than today's default when the document is large and the next level has enough divisions
   to be worth splitting (thresholds as built: total source over 80,000 characters, or any single
   division over 40,000, and ≥3 divisions at the deeper level, capped at depth 3). This settles
   SPEC §8.7 and is the direct answer to "large LaTeX documents with multiple sections".

   _Scoped narrower than the plan implied._ The heuristic reads LaTeX sectioning commands, so it
   only speaks for a LaTeX import. Markdown and PreTeXt inputs keep the historical default (a book
   splits its chapters, an article stays whole) until they grow an equivalent of their own —
   `resolveImportSplitLevel` branches on the source format. Applying the LaTeX heuristic to a
   PreTeXt document silently stopped books from splitting, which the existing `upload.spec.ts`
   caught.

3. **Clean per division, after splitting.** The pipeline becomes:

   ```
   raw LaTeX
     └─ splitLatexIntoChunks(splitLevel)          ← the generalized walker, shared
          ├─ chunk[i] ─ findFixes ─ applyFixes ─▶ cleaned[i]  (+ fixes[i], before/after)
          └─ join cleaned chunks
               └─ convert  (unified-latex, whole document — macro scope preserved)
                    └─ buildDivisionPool(splitLevel)   ← divisions align 1:1 with chunks
                         └─ serializeProjectToFiles
   ```

   Conversion still sees one document, so preamble macro scope and cross-references are unchanged.
   But cleaning is per chunk, so each generated file has an exact before/after pair and an exact
   fix list — with no offset mapping across the unified-latex boundary, which is the thing that
   has no general solution.

4. **Cheap re-layout**, so the wizard can re-split without re-converting.

   _Built differently from the plan._ The design called for splitting
   `importProjectFromFiles` into `prepareImport` + `layoutImport`. What shipped instead is a single
   pure function over an already-finished result:

   ```ts
   export function relayoutImport(
     result: ImportedProjectSuccess,
     splitLevel: number,
   ): ImportedProjectSuccess;
   ```

   Three reasons it came out this way. The 380-line `importProjectFromFiles` would have needed
   invasive surgery to split at the conversion seam, and every one of its branches (existing
   projects, multi-root attachment, native mode) would have had to be re-threaded through a new
   intermediate type. `ImportedProjectSuccess` already carries everything a re-layout needs —
   `pretextSource`, `documentKind`, `assets`, `projectLayout`, and now `cleanChunks`. And a pure
   result-to-result function is plain data in and plain data out, so it survives a webview
   boundary, where a `PreparedImport` holding closures would not.

   `relayoutImport` rebuilds only the division pool and re-serializes it, keeping the files the
   splitter does not own (publication, manifest, `.bib`, carried-over project files) exactly as
   they were.

   The chunking wrinkle resolved as the plan anticipated: `cleanLatexInChunks` cuts at **every**
   header regardless of level, and `mergeChunksAtLevel` folds adjacent chunks to show any shallower
   depth. Because the cut is a flat partition rather than a tree, folding is a concatenation rather
   than a rebuild.

## Wizard changes

- **Split control moves from the upload step to the review step** and becomes a depth stepper
  (0–3), not the current `splitSections` checkbox at
  [`import-wizard.tsx:806`](../packages/import/src/react/import-wizard.tsx#L806). The checkbox
  today sits _before_ `runImport`, so changing it re-runs the whole conversion; after the two-phase
  split it re-runs only `layoutImport`.
- **Live file tree** on the review step, recomputed on every depth change.
- **Per-file before/after diff**, expandable from the tree. Needs a small line-diff; write a
  minimal LCS-based one (~60 lines) in the wizard rather than adding a dependency, matching this
  repo's preference for dependency-free helpers (cf. the hand-rolled tar parser).
- The existing flat warning list stays as a document-level summary.

## Implementation phases

| Phase | Work                                                                                                    | Ships                            |
| ----- | ------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1     | `clean/` module in `latex-style-pretext`: rules, `findLatexFixes`, `applyLatexFixes`, spec parity tests | nothing user-visible             |
| 2     | `@pretextbook/import` consumes it; `cleanLatex` becomes a wrapper; existing specs green                 | verbatim/comment correctness fix |
| 3     | `latexFixesToDiagnostics` + code actions; wire into pretext-plus Monaco                                 | **Task 2** in pretext-plus       |
| 4     | Generalized LaTeX splitter + `suggestSplitLevel` + per-chunk cleaning                                   | better splits                    |
| 5     | `relayoutImport`; wizard split-depth control, live tree + per-file diff                                 | **Task 1**                       |
| 6     | Wire clean diagnostics + code actions into the VS Code LSP server                                       | Task 2 in pretext-tools          |

Phases 1–2 are the shared foundation; 3 and 4–5 are independent after that and can go in either
order.

## Risks

- **Behavior drift in phase 2.** `clean-latex.spec.ts`, `latex-clean.spec.ts` and
  `latex-scan.spec.ts` encode current behavior. Scanner-awareness _intentionally_ changes results
  inside verbatim and comments, so some expectations must be updated rather than preserved. Plan:
  keep every spec, and for each one that changes, record why in the diff. A golden-file test over a
  real imported document would catch unintended drift.
- **Fixpoint loop non-termination** if a rule's replacement re-matches its own pattern (e.g. a
  `replace` whose output contains the macro it matched). Cap the passes and assert in tests that
  the corpus stabilizes in one.
- **Chunk/division misalignment** in phase 4. If unified-latex drops or merges a heading, chunk _i_
  no longer corresponds to division _i_. _As built:_ `fileChangesForImport` joins on heading title
  and **drops** any title that is not unique, rather than guessing. A file with no confident match
  shows no diff at all — an empty diff would read as "nothing changed here" when the truth is "we
  cannot tell".
- **`\input`/`\include` inside a chunk.** Includes are expanded before splitting today
  (`expandTexInputs` in [`latex-includes.ts`](../packages/import/src/lib/clean/latex-includes.ts)); keep that order so
  chunks are self-contained.
- **Publishing.** pretext-plus consumes `@pretextbook/latex-style-pretext` from npm, so phase 3
  needs a release before it can land there. `@pretextbook/import` is already published alongside.
