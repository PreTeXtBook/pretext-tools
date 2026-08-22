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

### Division splitting

The converted document is split into one file per division, with
`source/main.ptx` rebuilt around `xi:include` references. How deep to split is
`splitLevel`:

```ts
importProjectFromFiles(files, {
  documentKind: "book", // override auto-detect
  splitLevel: 2, // 0 = one file; 1 = chapters; 2 = + their sections
});
```

`splitLevel` defaults to 1 for a book and 0 for an article. Every PreTeXt
division splits, not just chapters and sections — `<frontmatter>`, `<part>`,
`<appendix>`, `<worksheet>` and friends all get their own file. Files use the
usual prefixes (`ch-intro.ptx`, `sec-limits.ptx`), divisions a document has one
of are named for themselves (`frontmatter.ptx`), and a division's children live
in a directory named after it (`source/ch-intro/sec-first.ptx`).

The older `splitChapters` / `splitSections` booleans still work.

## Importing an existing PreTeXt project

If an upload contains a `project.ptx`, it is imported as a project rather than
as loose source: the first non-`standalone` target's source is resolved through
its `xi:include`s, re-split by division, and written back at its original path.
The publication file, images, custom XSL, and everything else are carried over
untouched at their original paths, so `<image source="…"/>` and
`<directories external="…"/>` keep resolving. `project.ptx` is regenerated,
preserving every original target, and stale `output/` directories are dropped.

```ts
const result = importProjectFromFiles(files, { assets });
result.analysis.manifest?.targets; // what the project declared
result.projectLayout; // { mainSourcePath, publicationPath, preserved: true }
```

Pass `preserveProjectLayout: false` to import it as loose source into the
standard layout instead.

## Choosing among several sources

`analyzeImportSources` surveys an uploaded file set without converting
anything — use it to drive a format dropdown or a main-file picker, then pass
the answers back:

```ts
import {
  extractUpload,
  analyzeImportSources,
  importProjectFromFiles,
} from "@pretextbook/import";

const { files, assets } = await extractUpload(file);
const analysis = analyzeImportSources(files);

analysis.formats; // e.g. ["latex", "markdown"]
analysis.candidates; // every file that could be the document root
analysis.primary; // the one that will be used by default
analysis.extraRoots; // other standalone documents in the upload

const result = importProjectFromFiles(files, {
  assets,
  sourceFormat: "latex", // force a format
  mainFile: "book/main.tex", // force the root
  attachRoots: [
    // fold the others in as divisions
    { path: "appendix.tex", level: "chapter" },
    { path: "notes.tex", include: false },
  ],
});
```

When several files are standalone documents (a `\documentclass` per chapter is
a common LaTeX habit), the extras are attached to the main document as chapters
or sections by default — their bodies are spliced in before conversion, with
their own `\input`s expanded and their preamble macros hoisted. Pass
`attachRoots: false` to import the main file alone.

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
files into `source/`. An archive that contains a `project.ptx` keeps its own
layout instead — see above.

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

`ImportWizard` is the full multi-step flow (upload → sources → review →
confirm). Its source-selection step — format dropdown, main-document picker,
and per-file attach controls — appears whenever the upload leaves a real choice
open, and is always reachable from the review step.

### Choosing the default import style

A LaTeX or Markdown upload can be imported two ways: `"converted"` (the
generated PreTeXt) or `"native"` (the cleaned original source, unconverted).
Each host picks which one the review step starts on — the VS Code extension
reads the `pretext-tools.import.defaultMode` setting; another host might read
an account preference:

```tsx
<ImportWizard
  defaultImportMode="native" // starts on "Keep as LaTeX"; user can still switch
  onImportModeChange={(mode) => remember(mode)}
  onConfirm={handleConfirm}
/>
```

Pass `lockImportMode` alongside it to hide the chooser entirely and import in
that one style — for hosts that only support one.

A PreTeXt upload has no native alternative, so the chooser is hidden and the
mode handed to `onConfirm` is always `"converted"`, whatever the default said.
Outside the wizard the same rules are available directly:

```ts
import {
  DEFAULT_IMPORT_MODE, // "converted"
  hasNativeImportMode, // does this result carry a native alternative?
  resolveImportMode, // preference + result → the mode that really applies
  filesForImportMode,
  assetsForImportMode,
  projectForImportMode,
} from "@pretextbook/import";

const mode = resolveImportMode(result, preferredMode);
const files = filesForImportMode(result, mode);
```
