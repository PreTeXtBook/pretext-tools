# @pretextbook/latex-style-pretext

Editor intelligence for **LaTeX-style PreTeXt** — LaTeX source that converts to PreTeXt via
[`@pretextbook/unified-latex-to-pretext`](https://github.com/PreTeXtPlus/unified-latex).

This package is platform-agnostic and returns LSP-shaped values
(`vscode-languageserver-types`), so it can be consumed both by the VS Code extension's LSP
server (Node) and by the Monaco editor in `pretext-plus-editor` (browser). It ships raw
TypeScript with no build step, following the `@pretextbook/completions` precedent.

## What's here

| Module         | Purpose                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `data/`        | Curated tables of the environments and macros the PreTeXt conversion supports   |
| `scan/`        | Lightweight linear document scanner (math regions, env stack, labels, comments) |
| `completions/` | Completion engine (Phase 2)                                                     |
| `lint/`        | Diagnostics engine (Phase 3)                                                    |
| `clean/`       | Legacy-LaTeX cleanup rules, shared with `@pretextbook/import`                   |

## Keeping the tables in sync with the converter

The curated tables in `data/` mirror what
`@pretextbook/unified-latex-to-pretext` will actually convert. Two guards keep them honest, in
opposite directions:

- **`converter-drift.spec.ts`** converts a usage of every curated entry and fails if the converter
  no longer recognizes it — this catches support being _removed_ or renamed.
- **`converter-coverage.spec.ts`** compares the tables against `data/converter-support.json` and
  fails if the converter supports something the tables lack — this catches support being _added_.

`converter-support.json` is generated, never hand-edited:

```sh
npm run refresh:latex-support     # regenerate from the installed converter
npm run check:latex-support       # fail if it is stale (CI runs this)
```

The snapshot has two halves, because the converter only exports half its surface:

- `environments` / `macros` / `plusMacros` / `plusTypes` come from the records the converter
  exports, complete with argument signatures.
- `probedMacros` / `probedEnvironments` are discovered by converting `\name{x}` and
  `\begin{name}…\end{name}` for every PreTeXt element name in the schema, because ordinary LaTeX
  and PreTeXt inline markup (`\alert`, `\q`, …) are handled through internal tables the converter
  does not export.

**To update after bumping the converter:** run `npm run refresh:latex-support`, then
`npm run test -w @pretextbook/latex-style-pretext`. The coverage spec names every entry that needs
adding; the drift spec names every entry that needs removing or promoting out of
`KNOWN_UNCONVERTED`.
