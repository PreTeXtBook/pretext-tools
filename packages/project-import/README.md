# @pretextbook/project-import

Shared helpers for importing existing source content into PreTeXt.

This package is intended for two use cases:

- VS Code extension logic: format detection and conversion utilities.
- Web apps: reusable React components for basic import UX.

## Install

```sh
npm install @pretextbook/project-import
```

## Utilities

```ts
import {
  detectSourceFormat,
  convertSourceToPretext,
} from "@pretextbook/project-import";

const sourceFormat = detectSourceFormat(rawInput);
const result = convertSourceToPretext(rawInput, sourceFormat);

if (result.pretextError) {
  console.error(result.pretextError);
} else {
  console.log(result.pretextSource);
}
```

## React Components

```tsx
import { ImportSourceForm } from "@pretextbook/project-import/react";

function ImportPanel() {
  return <ImportSourceForm onImport={(result) => console.log(result)} />;
}
```
