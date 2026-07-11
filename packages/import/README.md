# @pretextbook/import

Shared helpers for importing existing source content into PreTeXt.

Two use cases:

- VS Code extension logic: format detection, cleaning, and conversion utilities.
- Web apps: React components for paste-or-upload import UX, plus a non-React
  library entry point suitable for server-side or extension-host use.

The LaTeX cleaning pipeline is a TypeScript port of
[`davidfarmer/PreprocessLaTeX`](https://github.com/davidfarmer/PreprocessLaTeX)
(`src/main.js`'s `describeFiles` flow): drop comments, normalize whitespace,
expand `\input`/`\include`, rewrite plain-TeX font directives, scrub
presentation macros, and convert via `@pretextbook/latex-pretext`.

## Install

```sh
npm install @pretextbook/import
```

## Utilities

```ts
import {
  detectSourceFormat,
  convertSourceToPretext,
  importProjectFromFiles,
} from "@pretextbook/import";

const format = detectSourceFormat(rawInput);
const result = convertSourceToPretext(rawInput, format);

if ("pretextError" in result) {
  console.error(result.pretextError);
} else {
  console.log(result.pretextSource);
  console.log(result.warnings); // cleaning diagnostics
}

// Multi-file project import (file paths -> source text):
const project = importProjectFromFiles({
  "main.tex": "\\documentclass{article}\\begin{document}Hi.\\end{document}",
});
if ("outputFiles" in project) {
  // Standard PreTeXt project layout, keyed by path:
  console.log(project.outputFiles["source/main.ptx"]);
  console.log(project.outputFiles["project.ptx"]);
  console.log(project.outputFiles["publication/publication.ptx"]);
}
```

### Book splitting

If the converted source is a `<book>`, the layout splitter writes each
`<chapter>` to its own file under `source/`, and `source/main.ptx` is rebuilt
with `xi:include` references. Chapter filenames use `ch-<xml:id>.ptx` when an
`xml:id` is present, falling back to a zero-padded index. Pass
`splitSections: true` to additionally split each chapter by section.

```ts
importProjectFromFiles(files, {
  documentKind: "book", // override auto-detect
  splitSections: true,
});
```

## Upload pipeline

```ts
import { handleImportUploadFile } from "@pretextbook/import";

const result = await handleImportUploadFile(file);
if ("pretextError" in result) {
  console.error(result.pretextError);
} else {
  // Text files (the converted PreTeXt project + routed .bib auxiliaries)
  for (const [path, content] of Object.entries(result.outputFiles)) {
    saveOrUpload(path, content);
  }
  // Binary assets (images, PDFs, EPS) routed to source/assets/
  for (const [path, bytes] of Object.entries(result.outputAssets)) {
    saveBinary(path, bytes);
  }
  // Optional cleaned native source (LaTeX/Markdown), if the input was that format
  if (result.nativeOutputFiles) {
    for (const [path, content] of Object.entries(result.nativeOutputFiles)) {
      saveOrUpload(path, content);
    }
  }
}
```

Supports `.tex`, `.md`, `.ptx`, `.xml`, `.zip`, and `.tar.gz` uploads. For zip
and tar.gz archives, the extractor identifies the main source file, expands
LaTeX `\input`/`\include` or PreTeXt `xi:include` references, and routes
binaries (`.png`, `.jpg`, `.pdf`, `.eps`, ...) into `source/assets/` and `.bib`
files into `source/`.

## React Components

```tsx
import { ImportSourceForm, ImportUploadPanel } from "@pretextbook/import/react";

function ImportPanel() {
  return (
    <>
      <ImportSourceForm onImport={(r) => console.log(r)} />
      <ImportUploadPanel onImport={(r) => console.log(r)} />
    </>
  );
}
```

`ImportUploadPanel` exposes UI controls for the `documentKind` override and
`splitSections` toggle. Pass `importOptions={...}` to suppress those controls
and use a fixed configuration.
