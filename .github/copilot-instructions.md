# Copilot Instructions for pretext-tools

## Project Overview

This is a VS Code extension monorepo for [PreTeXt](https://pretextbook.org), an XML-based authoring language for scholarly documents. The extension provides language support (syntax highlighting, completions, formatting), a language server (LSP), a visual WYSIWYG editor, a LaTeX-to-PreTeXt converter, and a Prettier plugin.

## Build, Test, and Lint

This is an **npm workspaces** monorepo. Always run tasks through npm, not the underlying tools directly:

```sh
# Build the VS Code extension (the primary build target)
npm run build

# Build in dev/watch mode (rebuilds on file changes)
npm run build:dev

# Watch extension files for changes
npm run watch

# Run all tests (pretest rebuilds everything first)
npm test

# Run tests for a single package
npm run test -w @pretextbook/format
npm run test -w @pretextbook/completions

# Run specific test file
npm exec vitest run packages/format/src/lib/format.spec.ts

# Lint all packages
npm run lint

# Refresh PreTeXt schemas from upstream (updates completions defaults)
npm run refresh:schemas
```

### Common Development Workflows

**Running the extension locally** (from VS Code):
1. Run `npm run build:dev` to do an initial build
2. Press F5 to launch "Run Extension + LSP" compound configuration
3. This opens a new VS Code window with the extension loaded
4. Changes to TypeScript are auto-recompiled; reload the extension window to see them

**Attaching debugger to LSP server**:
1. Run "Run Extension + LSP" compound config (which starts both extension and LSP)
2. Set breakpoints in LSP code in `packages/vscode-extension/src/lsp-server/`
3. The debugger automatically attaches to port 6009

**Running extension tests**:
- From VS Code: Press Ctrl+Shift+D and select "Extension Tests"
- Or: `npm run build && npm exec vitest run packages/vscode-extension/src/test/suite/`

## Architecture

### Monorepo Structure

The repo has **12 npm packages** under `packages/` plus a non-package `extension/` directory:

**Core packages** (user-facing):
- **`vscode-extension`** (`pretext-tools`) — The main VS Code extension. Contains the extension host, LSP client, commands, and webview UI. Built with **esbuild** into two bundles: `out/extension.js` and `out/lsp-server.js`.
- **`visual-editor`** — React/TipTap-based WYSIWYG editor rendered in a VS Code webview. Built with **Vite**.
- **`prettier-plugin-pretext`** — Prettier plugin for PreTeXt XML. Built with **esbuild** (ESM + CJS).

**Library packages** (reusable):
- **`completions`** — Reusable completion/intellisense engine, consumed by the LSP server. Exports raw TypeScript source (no build step).
- **`format`** — PreTeXt document formatter library. Built with **Vite** (ESM + CJS).
- **`latex-pretext`** — LaTeX-to-PreTeXt conversion using `unified-latex`.

**Data structure/utility packages** (internal):
- **`ptxast`** — TypeScript type definitions for the PreTeXt Abstract Syntax Tree.
- **`remark-pretext`** — Markdown-to-PreTeXt AST transformer.
- **`ptxast-util-from-xml`**, **`ptxast-util-to-xml`**, **`ptxast-util-to-mdast`** — AST conversion utilities.

**Other**:
- **`playground`** — Dev-only web playground for testing latex-pretext conversions.
- **`extension/`** — *Not a package* — contains the extension manifest, TextMate grammar, snippets, and static assets that ship with the published extension.

### LSP Architecture

The extension runs a **separate LSP server process** spawned by the client via Node IPC (not stdio). The server handles completions, formatting, hover, document symbols, and schema validation.

- **Client** (`packages/vscode-extension/src/lsp-client/`): Runs in the extension host process, communicates with server via IPC.
- **Server** (`packages/vscode-extension/src/lsp-server/`): Spawned as a separate Node process, delegates to `@pretextbook/completions` and `@pretextbook/format`.
- **Schema validation**: PreTeXt RNG schemas live in `packages/vscode-extension/src/lsp-server/assets/`. Refresh with `npm run refresh:schemas`.

### Build Pipeline & Dependency Order

Packages have different build tools but must build in dependency order:

1. **Utilities first** (`build:utils`):
   - `ptxast` (types, no downstream dependencies)
   - `remark-pretext` (depends on ptxast)
   - `ptxast-util-*` (depend on ptxast, remark-pretext)

2. **Libraries** (`build:libs`):
   - `format`, `latex-pretext` (depend on utilities)
   - `completions` (depends on utilities; includes schema refresh step)
   - `visual-editor` (depends on utilities and format)

3. **Main extension** (`build`):
   - `vscode-extension` (depends on everything; esbuild produces extension.js and lsp-server.js)

Build tools used:
- **esbuild**: `vscode-extension`, `prettier-plugin-pretext` (fast, bundles everything into single files)
- **Vite**: `format`, `visual-editor` (library build with dual ESM/CJS exports)
- **No build**: `completions`, `latex-pretext` (consumed as TypeScript source or by downstream bundlers)

## Conventions

- **Commit messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `chore:`). Releases are automated via `semantic-release`.
- **Test files**: Use `*.test.ts` or `*.spec.ts` alongside source files. Test framework is **Vitest**.
- **Package exports**: Packages use dual ESM/CJS exports where applicable via Vite/esbuild config. The `completions` package is an exception — it exports raw `.ts` source.
- **Formatting**: Prettier with 2-space indentation (configured in root `package.json`). Use `npm run build` or IDE format-on-save.
- **TypeScript**: Strict mode enabled. Root `tsconfig.json` uses CommonJS module resolution with ESNext target.
- **Schema files**: PreTeXt completion schemas (`.rng`) live in `packages/vscode-extension/src/lsp-server/assets/`. Precomputed schemas committed to repo; refresh with `npm run refresh:schemas` when upstream changes.
- **Package naming**: Most packages are `@pretextbook/*` except `prettier-plugin-pretext` (not scoped).

## Important Paths

- `packages/vscode-extension/src/lsp-client/` — LSP client code
- `packages/vscode-extension/src/lsp-server/` — LSP server code (includes completions, formatting, validation)
- `packages/vscode-extension/src/lsp-server/assets/` — PreTeXt RNG schemas
- `packages/completions/src/default-dev-schema.ts` — Precomputed dev schema for bundling
- `extension/` — Extension manifest, snippets, TextMate grammar
- `dist/` — Build output directory (generated)
- `.github/workflows/` — CI/CD pipelines (GitHub Actions)

## Debugging Tips

- **Extension crashes?** Check `.github/workflows/ci.yml` for test/build requirements. Run `npm run test` locally first.
- **Completions not working?** Rebuild schema: `npm run refresh:schemas` then `npm run build:libs`.
- **LSP server not responding?** Check launch config in `.vscode/launch.json`. LSP runs on IPC, not stdio.
- **TypeScript errors in editor?** Ensure `dist/` exists: `npm run build` (not just `build:dev`).

