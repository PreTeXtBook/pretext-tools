# @pretextbook/import — Feature Specification

Status: **draft** (branch `import`). This document describes what the package
does today, what it is intended to do, and the decisions still open. The
[README](./README.md) is the user-facing usage doc; this is the design spec.

## 1. Purpose

A single shared engine for turning existing content — LaTeX, Markdown, or
loose PreTeXt — into a working, buildable PreTeXt project. The same pipeline
serves two consumers:

- **pretext-plus** (web): an import modal where an author pastes source or
  uploads a file/archive, reviews the conversion, and confirms creation of a
  new project.  Creates the new project with correctly scaffolded divisions and 
  assets in the requested format, using appropriate `<plus:section ref=".."/>` 
  or equivalent inclusions.
- **pretext-tools** (VS Code extension): an "import existing project" command
  that scaffolds a workspace folder from a LaTeX/Markdown/PreTeXt file or
  archive, without requiring external tools (pandoc, plastex, python).  Creates a
  new project in the requested directory or adds a parallel project as a subfolder of
  the current project's workspace.

Everything runs in pure TypeScript so it works identically in the browser and
in the extension host — no server round-trip, no native dependencies.

## 2. Consumers

| Consumer | Entry point | Output | Status |
|---|---|---|---|
| pretext-plus modal | `ImportWizard` from `@pretextbook/import/react` | `PlusProjectPayload` (§4.3) — divisions + assets mapped to the Rails create/PATCH endpoints | Component built; not yet integrated into pretext-plus |
| VS Code extension | `ImportWizard` in a webview panel (§6) | File tree (§4.2) posted to the host, written via `workspace.fs` | Wired: `pretext-tools.importProject` |
| Playground (dev) | `/import-smoke.html` — `ImportUploadPanel` + `ImportWizard` demos | Demos of both options above | Working |

The package is published to npm (`private: false`) so pretext-plus can depend
on it directly.

## 3. The pipeline

End-to-end, an import runs these stages. Stages 1–2 only apply to file
uploads; the paste flow (`convertSourceToPretext`) starts at stage 4.

```
upload (File)
  │ 1. extract        zip (JSZip) / tar.gz (DecompressionStream + minimal tar
  │                   parser) / single file; split text vs. binary by extension
  │ 2. pick main      find the primary source file among the extracted files
  │ 3. expand         inline \input/\include (LaTeX) or xi:include (PreTeXt)
  │ 4. detect/clean   detect format; for LaTeX, run the PreprocessLaTeX port
  │ 5. convert        LaTeX → unified-latex; Markdown → remark-pretext;
  │                   PreTeXt → normalize only. Then format via @pretextbook/format
  │ 6. layout         split books into chapter (and optionally section) files;
  │                   generate project.ptx and publication.ptx
  │ 7. route          images → source/assets/, .bib → source/
  ▼
ImportedProjectResult  (outputFiles + outputAssets + warnings + statusMessages)
```

### 3.1 Supported inputs

- Single files: `.tex`, `.md`/`.markdown`, `.ptx`, `.xml`
- Archives: `.zip`, `.tar.gz`/`.tgz`
- Pasted text (any of the three formats, auto-detected)

Binary entries inside archives (`png jpg jpeg gif pdf eps ps bmp tiff tif webp ico`) 
are kept as `Uint8Array` assets; everything else is decoded as
text with line endings normalized.

### 3.2 Format detection (`detectSourceFormat`)

Marker heuristics, checked in order:

1. Empty or starts with `<` → **pretext**
2. Contains a LaTeX marker (`\documentclass`, `\begin{document}`, `\begin{`,
   `\section`, `\chapter`, `\title`, `\author`) → **latex**
3. Starts with an ATX heading (`# ` … `#### `) → **markdown**
4. Otherwise → **pretext**

The user can always override detection (format dropdown in the UI; the
`sourceFormat` argument in the API).

### 3.3 Main-file selection (`pickPrimarySourcePath`)

For multi-file uploads:

Uploaded files may contain multiple files that are "root" documents.  We
decide if there is only one of them, otherwise ask the user to select one of the
candidates.  The heuristics for identifying root documents are:

- **LaTeX**: the `.tex` file containing `\begin{document}`, else the first
  `.tex` alphabetically.
- **Markdown**: the first `.md`/`.markdown` alphabetically.
- **PreTeXt**: `findLikelyMainPretextPath` (prefers a file with a `<pretext>`
  root / xi:includes).
- Fallback: first file alphabetically, re-detected by content.

If the set of uploaded files contains multiple formats, the user is prompted
to choose which format to use for the main document.  Root files that are not
chosen as the main file, 
or files that are not "reachable" from the main file via includes can still be
converted as standalone orphaned divisions.

### 3.4 Include expansion

- **LaTeX**: `\input{…}` / `\include{…}` inlined from the uploaded file set.
  Resolution tries the path as-given, with `.tex` appended, and relative to
  the main file's directory. Up to 3 nesting passes. Missing targets are
  reported as error status messages but do not abort the import.
- **PreTeXt**: `<xi:include href="…"/>` inlined, resolving `.ptx`/`.xml`
  extensions and relative paths, max depth 5, with the XML prolog stripped
  from included fragments. Missing targets reported, non-fatal.
- **Markdown**: no include mechanism (single file only).  Todo: add support
  for pretext-plus style includes, as well as quarto style includes.

### 3.5 LaTeX cleaning (`lib/clean/`)

A TypeScript port of David Farmer's
[PreprocessLaTeX](https://github.com/davidfarmer/PreprocessLaTeX)
`describeFiles` flow. Steps, in order (`cleanLatex`):

1. `trimJunk` — strip comments, `\end{document}` trailers, collapse blank runs
2. `specialPreprocess` — targeted rewrites that must happen first
3. `fixPlainTeX` × 2 — rewrite plain-TeX font directives (`{\bf …}` etc.);
   two passes catch nesting
4. `scanForAnomalies` — splits preamble/body/bibliography, then deletes or
   saves known-bad macro groups (presentation macros, publisher options,
   `eliminateAndSave` items) per the tables in `latex-data.ts`

Every mutation is recorded as a structured `CleaningWarning`:

```ts
{ action: "delete" | "replace" | "rewrite" | "save" | "anomaly",
  severity: "info" | "warning" | "error",
  kind, category, macro, occurrences, replacement?, message?, examples? }
```

These surface in the UI review step so the author can see exactly what the
cleaner did to their source.

### 3.6 Preamble metadata (`latex-preamble.ts`)

Before cleaning, the raw preamble is mined for:

- `\title` → `<title>` (LaTeX formatting stripped to plain text)
- `\author` → `<docinfo><author><personname>` — **first author only**
  (split on `\and`).  TODO: Check what unified-latex does with these and possibly fix there.
- `\newcommand`/`\DeclareMathOperator` definitions → `<docinfo><macros>`.  Creates a 
  string of these that pretext-plus can write into its own docinfo field.
- `\documentclass` — used to rebuild a minimal document for unified-latex

The conversion feeds unified-latex a reconstructed document (documentclass +
macros + body) so macro definitions register without leaking into output.

### 3.7 Conversion (`convert.ts`)

If the user requests that the source be converted to PreTeXt, we create a scaffolded
set of pretext files (ready for vs code or pretext-plus).

- **LaTeX** → `@pretextbook/latex-pretext` (unified-latex), then the fragment
  is wrapped: `<pretext><docinfo>…</docinfo><book|article><title>…` — `<book>`
  vs `<article>` chosen by whether the output contains `<chapter>`.
- **Markdown** → `@pretextbook/remark-pretext`.
- **PreTeXt** → passthrough.
- All outputs are normalized through `formatPretext` from
  `@pretextbook/format`.

Errors are captured and returned as `{ pretextError, warnings }` rather than
thrown.

The user can also elect to keep the source in its native format.

### 3.8 Project scaffolding (`lib/layout/`)

`buildPretextProjectFiles` turns a single converted PreTeXt string into a
standard project file map:

```
project.ptx                     ptx-version="2"; web (html) + print (pdf) targets
publication/publication.ptx    directories external/generated; chunking level 1
source/main.ptx                root document
source/ch-<xml:id>.ptx         one per chapter (books, when splitChapters)
source/<ch-slug>/sec-*.ptx     one per section (when splitSections)
```

- **Document kind**: auto-detected (`<book>` → book; `<article>` → article;
  bare `<chapter>` → book; else article) or overridden via `documentKind`.
  If told "book" but no `<book>` element exists, falls back to a single-file
  article layout with a warning.
- **Chapter files**: named `ch-<slugified xml:id>.ptx`; chapters without an
  `xml:id` get a zero-padded index (`ch-01.ptx`) plus an info warning.
  Duplicate slugs get `-2`, `-3`, … suffixes.
- **Splitting**: `splitChapters` defaults to true for books; `splitSections`
  is opt-in and nests section files under a per-chapter directory.
- `main.ptx` is rebuilt with `<xi:include>` references, the `xmlns:xi`
  namespace added to the root, `<pretext>` wrapper and XML prolog ensured.
- XML structure is located with a lightweight tokenizer (`xml-scan.ts`) that
  tracks nesting and skips comments/CDATA/PIs — deliberately not a full
  parser, since input at this stage is our own formatter's output.

### 3.9 Asset and auxiliary routing

- Image-like binaries (`png jpg … pdf eps ps`) → `assets/<basename>`
  (path flattened). TODO: Note this needs to be changed from current location.
- `.bib` files → `source/<basename>`.
- Everything else (`.sty`, `.bbl`, `.txt`, …) is counted in the status log
  but not copied into the output project.

### 3.10 Native mode ("keep as LaTeX/Markdown")

When the input was LaTeX or Markdown, the result also carries
`nativeOutputFiles` — the *cleaned* (but unconverted) source as
`source/main.tex` or `source/main.md`. The wizard offers this as an "Import
mode" choice on the review step, for authors who want their project hosted
but aren't ready to convert. What the host app does with a native-mode
project (build story, editing experience) is an open question — see §8.

### 3.11 Diagnostics

Two channels, both returned on every result:

- `statusMessages: { type: "loading" | "success" | "error", message }[]` —
  a human-readable progress log (file counts by type, main file chosen,
  includes expanded/missing, assets routed).
- `warnings: CleaningWarning[]` — structured record of every cleaning
  mutation and layout anomaly (see 3.5), suitable for a collapsible
  "what changed" report.

## 4. Output shapes (result contract)

Two hosts, two shapes, one intermediate model. The pipeline's real product is
a **division pool** (§4.1); each host consumes a serializer over it:

- **VS Code** → a file tree (§4.2): one file per division, `xi:include`
  hierarchy, `project.ptx` + `publication.ptx`, assets on disk.
- **pretext-plus** → a project payload (§4.3): flat division records with
  `<plus:* ref="…"/>` placeholder hierarchy, docinfo/title as project fields,
  assets as library uploads.

The shapes below are the *target* contract; §4.4 records what the code
returns today during the transition.

### 4.1 Intermediate model: the division pool

pretext-plus stores a project as a **flat pool of division records** whose
hierarchy is expressed by placeholder tags inside parent content (see
`pretext-plus-editor` `src/types/sections.ts`), and a file tree is just
another projection of the same pool — so the pool is the natural common
model:

```ts
interface ImportedProject {
  title: string;
  docinfo: string;              // full <docinfo>…</docinfo> element, or ""
  documentKind: "article" | "book";
  divisions: ImportedDivision[]; // exactly one isRoot; unreferenced = orphan
  assets: ImportedAsset[];
  statusMessages: StatusMessage[];
  warnings: CleaningWarning[];
}

interface ImportedDivision {
  xmlId: string;                // unique; NCName-safe slug (see ref rules, §4.3)
  type: DivisionType;           // "book" | "article" | "chapter" | "section" | …
  title: string;                // plain text
  sourceFormat: "pretext" | "latex" | "markdown";
  content: string;              // full division source, child refs as placeholders
  isRoot: boolean;
}

interface ImportedAsset {
  ref: string;                  // unique among divisions + assets
  fileName: string;             // original basename
  data: Uint8Array;
}
```

(Assets in pretext-plus are project-owned records with the same basic shape
as divisions — see PR
[PreTeXt-Plus#231](https://github.com/PreTeXtPlus/PreTeXt-Plus/pull/231) —
so this mirrors that model directly; `kind` is always `"file"` for imported
binaries.)

Conventions:

- **Child placeholders** use the pretext-plus syntax as the canonical
  internal form, matched to the division's own format:
  `<plus:chapter ref="x"/>` (pretext), `::chapter{ref="x"}` (markdown),
  `\plus{chapter}{x}` (latex). The file-tree serializer rewrites these to
  `<xi:include>`; the plus payload passes them through unchanged.
- **Image references** likewise use `<plus:image ref="x"/>` placeholders
  keyed to `ImportedAsset.ref`; the file-tree serializer resolves them to
  `<image source="…">` paths, the plus payload passes them through. This
  settles the image-rewriting gap (§7) once, host-independently.
- **Division content shape** follows the pretext-plus storage rules so the
  plus serializer is near-identity: a pretext division is a complete wrapper
  element (`<chapter xml:id="x"><title>…</title>…</chapter>`); a markdown
  division is YAML frontmatter (`division:`/`xmlid:`/`label:`) + body with a
  leading `# heading`; a latex division opens with its header macro
  (`\chapter{Title}\label{id}`).
- **Multi-root inputs** (§3.3): the pool has exactly one `isRoot` division.
  Secondary roots either become *orphan divisions* (present in the pool,
  referenced by nothing — pretext-plus's TOC surfaces these for placement)
  or separate `ImportedProject` results (→ separate plus projects / separate
  `project.ptx` targets in VS Code).

### 4.2 VS Code shape: file tree

What the webview posts to the host today (§6.2) and what
`buildPretextProjectFiles` produces — this shape is settled:

```ts
{
  files:  Record<string, string>;     // path → text content
  assets: Record<string, Uint8Array>; // path → bytes (base64 over postMessage)
}
```

with the layout of §3.8 (`project.ptx`, `publication/publication.ptx`,
`source/main.ptx`, `source/ch-*.ptx`, …) plus assets at project-root
`assets/` with `external="../assets"` in the publication file (§3.9 TODO).
Serialization from §4.1: each division → one file; placeholders →
`<xi:include href="…"/>` / `<image source="…"/>`; `docinfo` inlined into
`main.ptx` under `<pretext>`; orphan divisions → files not referenced by any
xi:include (written but reachable only by hand).

### 4.3 pretext-plus shape: project payload

What the Rails app (`PreTeXtPlus/PreTeXt-Plus`) accepts when creating a
project, as of the single-Asset-model refactor
([PR #231](https://github.com/PreTeXtPlus/PreTeXt-Plus/pull/231)): assets
are project-owned records written through nested attributes exactly like
divisions — no separate library/join endpoints. `ProjectsController` permits:

```
project: {
  title, pretext_source, docinfo, use_common_docinfo,
  divisions_attributes: [{ id?, ref, source, source_format, is_root, _destroy }],
  assets_attributes:    [{ id?, ref, kind, file, source, short_description,
                           description, title, _destroy }]
}
```

so one multipart `POST /projects` carries the whole import, and the
serializer output is a direct camelCase mirror:

```ts
interface PlusProjectPayload {
  title: string;
  docinfo: string;               // requires follow-up PATCH — see gaps below
  documentType: "article" | "book";
  divisions: {
    id: string;                  // client-minted UUID (Rails inserts it as the PK)
    ref: string;                 // the division's xml:id
    source: string;
    sourceFormat: "pretext" | "latex" | "markdown";
    isRoot: boolean;
  }[];
  assets: {
    id: string;                  // client-minted UUID, same pattern as divisions
    ref: string;
    kind: "file";                // imported binaries; "authored" unused by import
    fileName: string;            // → short_description; bytes attach as `file`
    data: Uint8Array;
  }[];
}
```

Rails-side rules the serializer must satisfy:

- `ref` must match `/\A[a-zA-Z_][a-zA-Z0-9\-_]*\z/` (`REF_REGEX`) and be
  unique across the project's divisions **and** assets (both models
  cross-validate).
- Exactly one division has `is_root: true` (model-validated).
- A pretext root division's `document_type` is read off its root tag
  (`<book>`/`<article>`), so converted imports carry their kind in content.
- Hierarchy placeholders (`plus:*` / `::…{ref}` / `\plus{…}{…}`) are exactly
  what the plus editor parses (`parseDivisionRefs`), so pool content passes
  through unmodified. `<plus:image ref="…"/>` placeholders resolve against
  the asset `ref`s at assembly time (the build sees a bare `<ref>.<ext>`
  external filename).

**Gaps found in pretext-plus (need Rails-side changes or workarounds):**

1. `ProjectsController#create` unconditionally calls `set_default_docinfo`,
   clobbering any imported docinfo — the importing page must follow with a
   `PATCH` (docinfo *is* permitted on update), or create relaxes to
   only-default-when-blank.
2. `document_type` is not a permitted param on create **or** update — a
   native latex/markdown *book* import can't be marked as a book (the editor
   reads `document_type` for non-pretext roots). Converted (pretext)
   imports are unaffected.
3. There is no import UI/endpoint in pretext-plus yet — the wizard will
   mount like the editor does (`_form.html.erb` pattern) and drive the
   create/PATCH endpoints above.

Native mode maps better here than in VS Code: latex/markdown divisions are
first-class in the plus editor, so a native import can split at
chapters/sections into native divisions joined by `\plus{…}{…}` /
`::…{ref="…"}` placeholders instead of collapsing to one file (answers §8.4
for this host).

### 4.4 Current implementation (transition)

`ImportedProjectSuccess` (see `lib/types.ts`) — field guide:

| Field | Meaning |
|---|---|
| `files` / `assets` | The extracted *input* file map (text / binary), as uploaded |
| `pretextSource` | The full converted PreTeXt document (single string, pre-split) |
| `outputFiles` | The *project to write*: main/chapters/project.ptx/publication.ptx + routed `.bib` |
| `outputAssets` | Binary assets to write (`source/assets/…`) |
| `nativeOutputFiles` | Optional cleaned-native alternative (`source/main.tex` or `.md`) |
| `sourcePath` / `sourceName` / `sourceType` | Which input file drove the import |
| `documentKind` | `article` \| `book` (detected or overridden) |
| `statusMessages`, `warnings` | Diagnostics (see 3.11) |

Errors are the union alternative `{ pretextError, statusMessages, warnings }` —
consumers discriminate with `"pretextError" in result`.

The intermediate model is implemented (`lib/pool/`): every success result
now carries `project: ImportedProject` built by `buildDivisionPool`, and
`outputFiles` is derived from it via `serializeProjectToFiles` — so both
hosts consume projections of the same pool and the webview protocol (§6.2)
keeps working unchanged. `serializeProjectToPlusPayload` produces §4.3's
payload. `buildPretextProjectFiles` remains exported for compatibility but
the pipeline no longer uses it. Still to migrate: `<plus:image ref>`
placeholder rewriting (image refs in content are untouched, §7), native-mode
divisions, and multi-root pools (§3.3).

Host-side helpers (`lib/import-mode.ts`) define mode resolution once for
every consumer — the wizard's preview, the VS Code webview app, and the
playground demo all call the same functions:
`filesForImportMode(result, mode)`, `assetsForImportMode(result, mode)`,
and `formatWarningLine(warning)` (plain-text warning rendering for logs /
the VS Code output channel).

## 5. UI components (`@pretextbook/import/react`)

Three components, increasing in completeness:

- **`ImportSourceForm`** — paste-a-snippet form: textarea, format dropdown
  (auto/latex/markdown/pretext), live detected-format display, convert
  button. Unstyled (semantic HTML); labels overridable for i18n/embedding.
- **`ImportUploadPanel`** — drag-drop/file-select upload with document-kind
  and split-sections controls and a status-message log. Unstyled; controls
  hidden when a fixed `importOptions` is passed.
- **`ImportWizard`** — the intended pretext-plus modal body. Tailwind-styled
  multi-step flow:
  1. **Upload** — drop zone + options (document kind, split sections)
  2. **Processing** — spinner
  3. **Review** — import summary (source, detected format, kind, file
     count); collapsible warnings list; for LaTeX input, a "Convert to
     PreTeXt" vs "Keep as LaTeX" mode choice; expandable per-file preview
     of the output tree; Cancel / Confirm buttons
  4. Terminal — `onConfirm(result, mode)` fires; host writes the files
     (upload to pretext-plus storage, or write to disk in VS Code)
  
  Error state offers "Try Another File".

Open styling question: the wizard uses Tailwind utility classes (and the
package ships a compiled `react.css`), while the other two components are
unstyled. See §8.

## 6. VS Code integration (webview panel)

The extension hosts the same `ImportWizard` React component in a **webview
panel**, so the import interface is written once and shared with
pretext-plus. This mirrors how the visual editor webview is already wired
(`visualEditor.ts` + `vite.webview.config.mts`).

### 6.1 Architecture

- Command **"PreTeXt: Import Project…"** (`pretext-tools.importProject`)
  opens a `WebviewPanel` that renders `ImportWizard`. The webview bundle is
  built by the extension's Vite webview config alongside the visual editor
  bundle, consuming the built `@pretextbook/import/react` entry and its
  compiled `react.css`.
- The **entire import pipeline runs inside the webview** — it is a browser
  context, so `File`, `DecompressionStream`, and JSZip all work exactly as
  they do on pretext-plus. The extension host never re-runs the conversion;
  it only writes files.
- On confirm, the webview resolves the chosen mode ("converted" vs
  "native") to a concrete file map and posts *that* to the host. Keeping
  the wire protocol at the "files to write" level insulates it from the
  planned redesign of the result contract (§4, §8).

### 6.2 Message protocol (webview → host)

| Message | Payload | Host action |
|---|---|---|
| `import-confirm` | `{ mode, files: Record<path, string>, assetsBase64: Record<path, string>, sourceName, documentKind, warnings: string[] }` | pick destination, write files |
| `import-cancel` | — | dispose the panel |

Binary assets are base64-encoded in the webview because VS Code's
`postMessage` only guarantees JSON-serializable payloads across supported
versions. The host rejects any path containing `..` or an absolute prefix
(zip-slip guard — native mode can carry raw archive paths).

### 6.3 Host write flow

1. `showOpenDialog` (folders only), defaulting to the current workspace
   folder.
2. If the chosen folder is non-empty, a modal offers **Create subfolder**
   (name suggested from the source filename) or **Write here anyway**.
3. Write files and decoded assets via `vscode.workspace.fs`
   (`createDirectory` + `writeFile`).
4. Log conversion warnings to the PreTeXt output channel; show a toast with
   **Open Folder** / **Open in New Window** actions.

### 6.4 Remaining and related work

- The selection-conversion command (`cmdConvertText`) could adopt
  `convertSourceToPretext` to gain the cleaning pass + warnings.
- Decide the fate of the pandoc/plastex paths (`importFiles.ts`): keep as
  fallback converters behind the existing quick-pick, or deprecate.
- Theming: the wizard's Tailwind palette is light-only, so the panel forces
  a light container for now. Resolving §8's styling question (CSS variables
  mapped to VS Code theme vars) removes this.
- The webview build is not part of the `watch:all` dev loop yet; a full
  `build:webview` run picks it up.

## 7. Known limitations (current implementation)

- **Image references are not rewritten.** Binaries are routed to
  `source/assets/`, but `<image source="…">` paths in the converted document
  still point at the original relative paths. Imports with images will need
  a path-rewriting pass (or route assets preserving directory structure).
- **Asset basenames are flattened** — two images with the same name in
  different directories collide silently.
- Only the **first author** is imported; `\and` co-authors are dropped.
- `.bib` files are copied but **bibliographies are not converted** to
  PreTeXt `<biblio>`; `\cite` handling depends on what unified-latex emits.
- **Native mode collapses to a single file** (`source/main.tex`) — the
  original multi-file structure is not preserved, and the emitted
  `project.ptx` still points at `source/main.ptx`, not the native source.
- The **tar parser is minimal**: no PAX/GNU long-name entries, no symlinks.
- **Markdown** has no multi-file story (first `.md` wins, no includes).
- Detection heuristics favor LaTeX: a Markdown document containing
  `\section` or `\begin{` anywhere is detected as LaTeX.
- `docinfoPath` option exists (`source/docinfo.ptx` default) but **nothing
  writes a docinfo file** — docinfo stays inline in `main.ptx`. Dead option
  until implemented (or should be removed).
- No size limits or zip-bomb guards on archive extraction.

## 8. Open questions

Design decisions to settle before merging (several were left as inline
comments in `upload.ts`):

1. **Double normalization** — `extractFilesFromUpload` normalizes paths and
   text, then `importProjectFromFiles` normalizes again. Harmless but
   redundant; keep the second pass (public API may be called directly with
   un-normalized maps) or drop the first?
2. **`pickPrimarySourcePath` re-derives the source type** even when a
   single-file upload already knows it (e.g. a lone `.xml` file whose
   content looks like LaTeX would be treated as LaTeX). Should the upload
   extension win, or content sniffing?
3. **Hand-rolled tar parser** — keep it dependency-free, or take a small,
   maintained dependency for robustness (long names, sparse files)?
4. **Wizard native mode**: should "Keep as LaTeX" preserve the original
   multi-file layout instead of the expanded/cleaned single file? Should it
   emit a `project.ptx` with a LaTeX-source target instead of the PreTeXt
   one? *(Answered for the pretext-plus host: split into native divisions
   with `\plus{…}{…}` placeholders — see §4.3. Still open for VS Code.)*
5. **Styling strategy for React components** — Tailwind for all three (and
   require consumers to load `react.css`), or CSS-variables/unstyled with
   the host app themable? pretext-plus's stack should decide this.
6. **API surface** — `handleImportUploadFile` (browser `File`) vs
   `importProjectFromFiles` (path map). Should there be a third,
   Node-friendly `importProjectFromDisk(dir)` helper for the extension, or
   does that belong in the extension itself?
7. **Where do split thresholds live?** Chapter splitting is automatic for
   books; sections opt-in. Should very large articles split by section too?
8. **Publication defaults** — chunking level 1, external/generated dirs:
   confirm these match current pretext-cli template output.
9. **Scope of `project.ptx` targets** — web + print only; add epub or
   others, or keep minimal?
10. **Versioning/publish plan** — is `@pretextbook/import` versioned with
    the monorepo's semantic-release, and does pretext-plus pin or float?

## 9. Test coverage

Vitest specs live alongside sources: cleaning (`clean-latex`, `latex-clean`,
`latex-preamble`, `latex-scan`, `latex-utils`, `pretext-includes`), detection
(`detect-source-format`), layout (`build-project-files`, `document-kind`,
`xml-scan`), and the upload pipeline (`upload.spec.ts`). The React components
have no automated tests yet — the playground smoke page
(`packages/playground/import-smoke.html`) is the manual harness.

Note: the monorepo root `npm test` does **not** include this package; run
`npm run test -w @pretextbook/import` directly.
