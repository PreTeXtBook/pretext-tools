# @pretextbook/completions

Reusable completion logic for PreTeXt editing.

This package extracts completion generation from the VS Code extension LSP so it can be used by other tools (including non-LSP projects).

## Usage

```ts
import { getPretextCompletions } from "@pretextbook/completions";

const items = await getPretextCompletions({
  text,
  position: { line: 10, character: 4 },
  schema,
  references,
  currentFileDir,
});
```

The returned completion items follow `vscode-languageserver` completion item types.
