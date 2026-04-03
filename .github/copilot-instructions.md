# Copilot Instructions for pretext-tools

## Project Overview

This is a VS Code extension monorepo for [PreTeXt](https://pretextbook.org), an XML-based authoring language for scholarly documents. The extension provides language support (syntax highlighting, completions, formatting), a language server (LSP), a visual WYSIWYG editor, a LaTeX-to-PreTeXt converter, and a Prettier plugin.

## Build, Test, and Lint

This is an **Nx monorepo** using **npm workspaces**. Always run tasks through Nx, not the underlying tools directly:

```sh
# Build the VS Code extension (the primary build target)
npm run build

# Build in dev/watch mode
npm run build:dev
npm run watch

# Run all tests
npm test

# Run tests for a single package
npx nx test format
npx nx test completions

# Lint all packages
npm run lint
```

## Architecture

### Monorepo Structure

The repo has two key directories:

- **`packages/`** — Six npm packages under the `@pretextbook` scope:
  - **`vscode-extension`** (`pretext-tools`) — The main VS Code extension. Contains the extension host, LSP client, commands, and webview UI. Built with **esbuild** into two bundles: `out/extension.js` and `out/lsp-server.js`.
  - **`completions`** — Reusable completion/intellisense engine, consumed by the LSP server. Exports raw TypeScript source (no build step).
  - **`format`** — PreTeXt document formatter library. Built with **Vite** (ESM + CJS).
  - **`visual-editor`** — React/TipTap-based WYSIWYG editor rendered in a VS Code webview. Built with **Vite**.
  - **`latex-pretext`** — LaTeX-to-PreTeXt conversion using `unified-latex`.
  - **`prettier-plugin-pretext`** — Prettier plugin for PreTeXt XML. Built with **esbuild** (ESM + CJS).
- **`extension/`** — Published extension manifest, TextMate grammar, snippets, and static assets. This is *not* a package — it holds the files that ship alongside the built extension.

### LSP Architecture

The extension runs a **separate LSP server process** (`packages/vscode-extension/src/lsp-server/`) spawned by the client (`packages/vscode-extension/src/lsp-client/`) via Node IPC. The server handles completions, formatting, hover, document symbols, and schema validation. Completion logic is delegated to the `@pretextbook/completions` package; formatting to `@pretextbook/format`.

### Build Pipeline

Each package has its own build tool:
- **vscode-extension**: esbuild (`build.mjs`) — two entry points for extension host and LSP server
- **format**, **visual-editor**: Vite library builds
- **prettier-plugin-pretext**: esbuild (`build.mjs`)
- **completions**, **latex-pretext**: no build step (consumed as TypeScript source or handled by downstream bundlers)

Nx orchestrates cross-package builds via `@nx/js/typescript` and `@nx/vite/plugin`. Build output goes to `dist/`.

## Conventions

- **Commit messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `chore:`). Releases are automated via `semantic-release`.
- **Test files**: Use `*.test.ts` or `*.spec.ts` alongside source files. Test framework is **Vitest**.
- **Package exports**: Packages use dual ESM/CJS exports where applicable. The `completions` package is an exception — it exports raw `.ts` source.
- **Formatting**: Prettier with 2-space indentation (configured in root `package.json`).
- **TypeScript**: Strict mode enabled. Root `tsconfig.json` uses CommonJS module resolution with ESNext target.
- **Schema files**: PreTeXt schemas (`.rng`) live in the LSP server's assets directory and are used for validation and completions. Refresh with `npm run refresh:schemas`.
