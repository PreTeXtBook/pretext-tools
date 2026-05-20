# pretext-tools monorepo

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/oscarlevin.pretext-tools?color=informational&logo=visualstudiocode&style=for-the-badge&label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=oscarlevin.pretext-tools)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/oscarlevin.pretext-tools?logo=visualstudiocode&color=informational&style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=oscarlevin.pretext-tools)

This monorepo contains the [PreTeXt Tools VS Code extension](https://marketplace.visualstudio.com/items?itemName=oscarlevin.pretext-tools) and its supporting packages. [PreTeXt](https://pretextbook.org) is an XML-based authoring language for scholarly documents.

## Packages

| Package | Description |
|---|---|
| [`pretext-tools`](packages/vscode-extension) | VS Code extension — language support, CLI front-end, formatter, and more |
| [`@pretextbook/completions`](packages/completions) | Reusable completion/intellisense engine |
| [`@pretextbook/format`](packages/format) | PreTeXt document formatter library |
| [`@pretextbook/latex-pretext`](packages/latex-pretext) | LaTeX-to-PreTeXt conversion |
| [`@pretextbook/visual-editor`](packages/visual-editor) | React/TipTap-based WYSIWYG editor (webview UI) |
| [`prettier-plugin-pretext`](packages/prettier-plugin-pretext) | Prettier plugin for PreTeXt XML |
| [`@pretextbook/ptxast`](packages/ptxast) | TypeScript types for the PreTeXt AST |

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

### Linting

```bash
npm run lint
```

### Refreshing Schemas

```bash
npm run refresh:schemas
```

## Contributing

Like this project? [Star it on GitHub](https://github.com/oscarlevin/pretext-tools/stargazers)!

Have an idea or suggestion? [Open a feature request](https://github.com/oscarlevin/pretext-tools/issues).

Found something wrong? [File an issue](https://github.com/oscarlevin/pretext-tools/issues).

Pull requests welcome.
