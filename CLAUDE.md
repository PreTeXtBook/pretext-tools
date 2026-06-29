# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

npm workspaces monorepo for the [PreTeXt Tools VS Code extension](https://marketplace.visualstudio.com/items?itemName=oscarlevin.pretext-tools). PreTeXt is an XML-based authoring language for scholarly documents. The extension provides language support (syntax highlighting, completions, formatting), an LSP server, a WYSIWYG editor webview, a LaTeX-to-PreTeXt converter, and a Prettier plugin.

## Commands

```sh
# Install dependencies
npm install

# Build the VS Code extension (all deps first, then extension)
npm run build

# Build in watch/dev mode
npm run build:dev

# Build a single package
npm run build -w @pretextbook/format

# Run all tests (pretest rebuilds everything first)
npm test

# Run tests for a single package
npm run test -w @pretextbook/completions
npm run test -w prettier-plugin-pretext

# Run a specific test file
npm exec vitest run packages/format/src/lib/format.spec.ts

# Lint
npm run lint

# Refresh PreTeXt RNG schemas from upstream
npm run refresh:schemas
```

**Running the extension locally (VS Code):**
1. `npm run build:dev` for an initial build
2. Press F5 to launch the "Run Extension + LSP" compound configuration
3. Reload the extension window to pick up TypeScript recompilation

**LSP debugger:** The LSP server auto-attaches on port 6009 when launched via the compound config. Set breakpoints in `packages/vscode-extension/src/lsp-server/`.

## Architecture

### Packages

| Package | Role | Build tool |
|---|---|---|
| `vscode-extension` (`pretext-tools`) | Main VS Code extension: extension host, LSP client, commands, webview | esbuild → `out/extension.js` + `out/lsp-server.js` |
| `visual-editor` | React/TipTap WYSIWYG editor (VS Code webview UI) | Vite |
| `prettier-plugin-pretext` | Prettier plugin for PreTeXt XML | esbuild (ESM + CJS) |
| `completions` | Completion/intellisense engine (consumed by LSP server) | None — exports raw `.ts` source |
| `format` | PreTeXt document formatter library | Vite (ESM + CJS) |
| `latex-pretext` | LaTeX-to-PreTeXt conversion via `unified-latex` | None |
| `ptxast` | TypeScript types for the PreTeXt AST | tsc |
| `remark-pretext`, `ptxast-util-*` | AST conversion utilities | tsc |
| `playground` | Dev-only web playground for testing conversions | Vite |

`extension/` (not a package) — extension manifest, TextMate grammar, snippets, and static assets that ship with the published extension.

### LSP Architecture

The extension spawns a **separate LSP server process** via Node IPC (not stdio):

- **Client** (`packages/vscode-extension/src/lsp-client/`) — runs in the extension host process
- **Server** (`packages/vscode-extension/src/lsp-server/`) — spawned Node process; delegates to `@pretextbook/completions` and `@pretextbook/format`
- **Schema validation** — PreTeXt RNG schemas in `packages/vscode-extension/src/lsp-server/assets/`; refresh with `npm run refresh:schemas`

### Build Order

`npm run build` enforces this dependency order:

1. **Utils** (`build:utils`): `ptxast` → `remark-pretext` → `ptxast-util-*`
2. **Libs** (`build:libs`): `format`, `latex-pretext`, `completions` (includes schema refresh), `visual-editor`
3. **Extension** (`build`): `vscode-extension` (bundles everything via esbuild)

## Conventions

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `chore:`). Releases are automated via `semantic-release`.
- **Tests**: `*.test.ts` / `*.spec.ts` alongside source files. Framework: **Vitest**.
- **Formatting**: Prettier with 2-space indentation (root `package.json`).
- **TypeScript**: Strict mode. Root `tsconfig.json` targets CommonJS module resolution with ESNext.
- **Schemas**: Precomputed RNG schemas are committed to the repo. Run `npm run refresh:schemas` when upstream PreTeXt schemas change; this regenerates `packages/completions/src/default-dev-schema.ts` and `@pretextbook/ptxast` types.
