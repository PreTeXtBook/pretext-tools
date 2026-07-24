# @pretextbook/markdown-style-pretext

Editor intelligence for **Markdown-style PreTeXt** — CommonMark + GFM plus
[remark-directive](https://github.com/remarkjs/remark-directive) extensions that convert to
PreTeXt via [`@pretextbook/remark-pretext`](../remark-pretext).

This package implements the **same** `PretextFlavorLanguage` interface as
[`@pretextbook/latex-style-pretext`](../latex-style-pretext), so the VS Code LSP server and the
Monaco editor in `pretext-plus-editor` register it alongside the LaTeX flavor with no adapter
changes. It returns LSP-shaped values (`vscode-languageserver-types`) and ships raw TypeScript
with no build step, following the `@pretextbook/completions` precedent.

## What's here

| Module         | Purpose                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `data/`        | Curated table of container directives (mirrors the converter); math re-exported from the LaTeX flavor |
| `scan/`        | Lightweight linear scanner (math regions, directive stack, fenced code, comments, frontmatter, ids)   |
| `completions/` | Completion engine (container/leaf directives, cross-references, KaTeX math)                           |
| `lint/`        | Diagnostics engine (unmatched fences, unknown directives, unknown math macros)                        |

## The directive forms

- **Container fence** (`:::name` … `:::`) — the workhorse; a **fixed** vocabulary (the curated
  table), so an unknown name is flagged by lint. A fence's open and close must use the **same
  number of colons** to pair (mirrors `directive-normalizer.ts`); a mismatched close is an error.
- **Python-style** (`Name:` with an indented body) — opens a directive whose body is the
  deeper-indented block and closes implicitly on dedent (mirrors `indentation-normalizer.ts`).
  This dialect disables indented code blocks, so indentation is always directive structure.
  Recognized only for supported directive names, so it needs no unknown-directive lint.
- **Leaf** (`::name{…}`) — the PreTeXt Plus **include** syntax; any name becomes `<plus:name/>`,
  so leaf names are offered as completions but never validated.
- **Text** (`:name[…]`) — inline; the converter has no handler yet (they become `<TODO>`
  placeholders), so this flavor neither completes nor lints them.

A drift-guard test (`data/directives.drift.spec.ts`) runs every curated container directive
through `@pretextbook/remark-pretext` and asserts it still converts without an "unsupported"
warning, keeping the table honest against the in-repo converter.
