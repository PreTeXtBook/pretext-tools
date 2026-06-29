# @pretextbook/completions

Reusable completion logic for PreTeXt editing.

This package extracts completion generation from the VS Code extension LSP so it can be used by other tools (including non-LSP projects).

## Usage

```ts
import { getPretextCompletions } from "@pretextbook/completions";

const items = await getPretextCompletions({
  text,
  position: { line: 10, character: 4 },
  references,
  currentFileDir,
  sourceFiles,
});
```

The returned completion items follow `vscode-languageserver` completion item types.

If `schema` is omitted, the package uses a bundled precomputed PreTeXt dev schema.
You can still provide `schema` explicitly (for custom/stable/publication/project schema behavior).

For `href`/`source` file completions, pass `sourceFiles` explicitly (typically discovered by the host environment).
Absolute paths are recommended when `currentFileDir` is provided so the package can offer `../`-style relative suggestions.

## Schema Refresh Workflow

The bundled default schema is generated from `extension/assets/schema/pretext-dev.rng`.

- `npm run build -w @pretextbook/completions` refreshes the latest dev schema and regenerates `src/default-dev-schema.ts` before compiling.
- `npm run refresh:schemas` (from workspace root) refreshes all extension schemas and regenerates the completions default schema.
