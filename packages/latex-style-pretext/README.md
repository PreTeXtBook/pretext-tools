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

The curated tables mirror the converter's support surface. A drift-guard test keeps them honest
against the in-repo converter — see the blueprint in `docs/latex-style-pretext-blueprint.md`.
