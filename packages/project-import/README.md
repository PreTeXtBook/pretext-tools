# @pretextbook/project-import

Shared helpers for importing existing source content into PreTeXt.

This package is intended for two use cases:

- VS Code extension logic: format detection and conversion utilities.
- Web apps: reusable React components for basic import UX.

The upload flow is modeled after the `handleFile` pipeline from
`davidfarmer/PreprocessLaTeX` (`src/main.js`): detect upload type, extract
single-file or archive content, identify the main source file, expand LaTeX
`\\input`/`\\include` references, and convert to PreTeXt.

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

## Upload/Import Pipeline

```ts
import { handleImportUploadFile } from "@pretextbook/project-import";

const result = await handleImportUploadFile(file);

if ("pretextError" in result) {
  console.error(result.pretextError);
} else {
  console.log(result.pretextSource);
  console.log(result.sourcePath);
  console.log(result.statusMessages);
}
```

React helper:

```tsx
import { ImportUploadPanel } from "@pretextbook/project-import/react";

function ImportView() {
  return <ImportUploadPanel onImport={(result) => console.log(result)} />;
}
```
