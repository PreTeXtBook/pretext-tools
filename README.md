# pretext-tools monorepo

[![CI](https://github.com/PreTeXtBook/pretext-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/PreTeXtBook/pretext-tools/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/PreTeXtBook/pretext-tools)](LICENSE)

This monorepo contains the [PreTeXt Tools VS Code extension](https://marketplace.visualstudio.com/items?itemName=oscarlevin.pretext-tools) and its supporting packages. [PreTeXt](https://pretextbook.org) is an XML-based authoring language for scholarly documents.

## Packages

| Package | Description |
|---|---|
| [`pretext-tools`](packages/vscode-extension) | VS Code extension — language support, CLI front-end, live preview, visual editor, formatter, and more |
| [`@pretextbook/completions`](packages/completions) | Reusable completion/intellisense engine |
| [`@pretextbook/schema`](packages/schema) | Schema-based validation (duplicate ids, cross-references, and more) |
| [`@pretextbook/format`](packages/format) | PreTeXt document formatter library |
| [`@pretextbook/latex-pretext`](packages/latex-pretext) | LaTeX-to-PreTeXt conversion |
| [`@pretextbook/import`](packages/import) | Import wizard for turning existing documents into PreTeXt projects |
| [`@pretextbook/pretext-html`](packages/pretext-html) | PreTeXt-to-HTML rendering in pure JS (official XSLT via WebAssembly), powering Instant/Live Preview |
| [`@pretextbook/visual-editor`](packages/visual-editor) | React/TipTap-based WYSIWYG editor (webview UI) |
| [`@pretextbook/ptxast`](packages/ptxast) | TypeScript types for the PreTeXt AST |
| [`@pretextbook/remark-pretext`](packages/remark-pretext) | Markdown ⇄ PreTeXt AST conversion |
| [`@pretextbook/ptxast-util-to-mdast`](packages/ptxast-util-to-mdast) | PreTeXt AST ⇄ Markdown AST conversion |

## Development

This workspace uses npm workspaces. After cloning, install dependencies with:
```bash
npm install
```

### Building

```bash
# Build the VS Code extension (and all dependencies)
npm run build

# Build in watch/dev mode
npm run build:dev

# Build a specific package
npm run build -w @pretextbook/format
```

### Testing

```bash
# Run all tests
npm test

# Test a specific package
npm run test -w @pretextbook/completions
```

See [**Testing Guide**](docs/TESTING.md) for detailed instructions on running unit and integration tests for the VS Code extension, understanding the two-layer test architecture, and troubleshooting common issues.

### Linting

```bash
npm run lint
```

### Refreshing Schemas

```bash
npm run refresh:schemas
```

## Contributing

Like this project? [Star it on GitHub](https://github.com/PreTeXtBook/pretext-tools/stargazers)!

Have an idea or suggestion? [Open a feature request](https://github.com/PreTeXtBook/pretext-tools/issues).

Found something wrong? [File an issue](https://github.com/PreTeXtBook/pretext-tools/issues).

Pull requests welcome.
