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
  new project. Creates the new project with correctly scaffolded divisions and
  assets in the requested format, using appropriate `<plus:section ref=".."/>`
  or equivalent inclusions.
- **pretext-tools** (VS Code extension): an "import existing project" command
  that scaffolds a workspace folder from a LaTeX/Markdown/PreTeXt file or
  archive, without requiring external tools (pandoc, plastex, python). Creates a
  new project in the requested directory or adds a parallel project as a subfolder of
  the current project's workspace.

Everything runs in pure TypeScript so it works identically in the browser and
in the extension host — no server round-trip, no native dependencies.

## 2. Consumers

| Consumer           | Entry point                                                       | Output                                                                                      | Status                                                |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| pretext-plus modal | `ImportWizard` from `@pretextbook/import/react`                   | `PlusProjectPayload` (§4.3) — divisions + assets mapped to the Rails create/PATCH endpoints | Component built; not yet integrated into pretext-plus |
| VS Code extension  | `ImportWizard` in a webview panel (§6)                            | File tree (§4.2) posted to the host, written via `workspace.fs`                             | Wired: `pretext-tools.importProject`                  |
| Playground (dev)   | `/import-smoke.html` — `ImportUploadPanel` + `ImportWizard` demos | Demos of both options above                                                                 | Working                                               |

The package is published to npm (`private: false`) so pretext-plus can depend
on it directly.

## 3. The pipeline

End-to-end, an import runs these stages. Stages 1–2 only apply to file
uploads; the paste flow (`convertSourceToPretext`) starts at stage 4.

```
upload (File)
  │ 1. extract        zip (JSZip) / tar.gz (DecompressionStream + minimal tar
  │                   parser) / single file; split text vs. binary by extension
  │ 2. analyze        find project.ptx; enumerate every possible root and the
  │                   formats on offer; pick the primary (§3.3)
  │ 3. expand         inline \input/\include (LaTeX) or xi:include (PreTeXt)
  │ 4. attach         fold any other roots into the main document (§3.12)
  │ 5. detect/clean   detect format; for LaTeX, run the PreprocessLaTeX port
  │ 6. convert        LaTeX → unified-latex; Markdown → remark-pretext;
  │                   PreTeXt → normalize only. Then format via @pretextbook/format
  │ 7. split          divisions → the pool, to `splitLevel` levels deep (§3.8)
  │ 8. layout         serialize the pool; generate or preserve project.ptx and
  │                   publication.ptx (§3.13)
  │ 9. route          images → source/assets/ (new projects) or their original
  │                   paths (existing projects); .bib → source/
  ▼
ImportedProjectResult  (outputFiles + outputAssets + warnings + statusMessages)
```

Stage 2 is exposed on its own as `analyzeImportSources(files)`, and stage 1 as
`extractUpload(file)`. A host that wants to _ask_ before importing runs
extract → analyze → (show pickers) → `importProjectFromFiles(files, options)`;
`handleImportUploadFile` remains the one-shot path that does all of it with
defaults.

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

### 3.3 Root selection (`analyzeImportSources`)

One survey of the upload answers every "which file?" question, and both the
pipeline and the host's pickers read it, so what the user is shown and what the
import actually does cannot drift apart:

```ts
interface UploadAnalysis {
  manifest: ProjectManifest | null; // the project.ptx governing the upload
  candidates: RootCandidate[]; // every file that could be the root, best first
  formats: SourceFormat[]; // formats represented, in preference order
  primary: RootCandidate | null; // what the import will use
  extraRoots: RootCandidate[]; // other roots of the same format (§3.12)
}

interface RootCandidate {
  path: string;
  format: SourceFormat;
  reason:
    | "manifest-target"
    | "latex-root"
    | "pretext-root"
    | "markdown-root"
    | "fallback";
  title?: string; // mined from <title> / \title / `# heading`
  targetName?: string; // when it came from a project.ptx target
  targetFormat?: string;
}
```

Candidates are gathered per format and ranked:

- **`project.ptx` targets** win outright — an existing project knows its own
  root. The default target is the first non-`standalone` one (§3.12).
- **LaTeX**: files that are not `\input` by another file and declare
  `\documentclass` or `\begin{document}`. Ranked by: real `\documentclass`
  first; then a conventional driver name (`main`, `book`, `index`, `thesis`, …);
  then how many files it pulls in; then alphabetically.
- **Markdown**: all `.md`/`.markdown`, preferring `main`/`index`/`book` and
  demoting `README`, `CHANGELOG`, `LICENSE` — repository documentation is not
  the book.
- **PreTeXt**: files with a `<pretext>`/`<book>`/`<article>` root that no other
  file `xi:include`s (and never `project.ptx`/`publication.ptx` themselves).

Two options override the ranking, and are exactly what a host's controls bind
to: `sourceFormat` restricts candidates to one format, `mainFile` names the
root outright. Roots that are neither chosen nor reachable from the chosen one
are offered as `extraRoots` (§3.12).

### 3.4 Include expansion

- **LaTeX**: `\input{…}` / `\include{…}` inlined from the uploaded file set.
  Resolution tries the path as-given, with `.tex` appended, and relative to
  the main file's directory. Up to 3 nesting passes. Missing targets are
  reported as error status messages but do not abort the import.
- **PreTeXt**: `<xi:include href="…"/>` inlined, resolving `.ptx`/`.xml`
  extensions and relative paths, max depth 5, with the XML prolog stripped
  from included fragments. Missing targets reported, non-fatal.
- **Markdown**: no include mechanism (single file only). Todo: add support
  for pretext-plus style includes, as well as quarto style includes.

Both expanders report the paths they consumed. That set is what tells an
existing-project import which files were folded into the document (and so must
_not_ also be copied through verbatim — §3.13), and what keeps a file that is
merely a chapter part out of the root candidate list (§3.3).

### 3.5 LaTeX cleaning (`lib/clean/`)

The rules themselves live in **`@pretextbook/latex-style-pretext`'s `clean/`
module**, shared with the editors (pretext-plus's Monaco, the VS Code LSP
server) so an author who cleans up LaTeX in the editor gets exactly what the
importer would have done. They descend from David Farmer's
[PreprocessLaTeX](https://github.com/davidfarmer/PreprocessLaTeX)
`describeFiles` flow; see `docs/latex-clean-and-split-blueprint.md`.

What remains on this side is import-specific:

1. `trimJunk` — strip comments, `\end{document}` trailers, collapse blank runs.
   Deliberately not shared: deleting every comment is right for an import and
   wrong for an editor.
2. `cleanLatexText` (from the shared engine) — find every positioned fix and
   apply them to a fixpoint. Rules never fire inside comments or verbatim
   bodies, and the bibliography is off-limits to all of them.
3. `fixesToWarnings` — roll the positioned fixes up into the aggregate
   `CleaningWarning` rows the wizard's summary list renders.

`cleanLatexInChunks` (`clean-chunks.ts`) is the same pass, cut at every
division header so each piece carries its own before/after text and fix list —
see §3.8. Its `output` is what conversion consumes.

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
  (split on `\and`). TODO: Check what unified-latex does with these and possibly fix there.
- `\newcommand`/`\DeclareMathOperator` definitions → `<docinfo><macros>`. Creates a
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

### 3.8 Division splitting (`lib/pool/division-pool.ts`)

The converted document is split into the division pool (§4.1) by walking its
divisions to a configurable depth:

```
splitLevel 0   whole document in one division
splitLevel 1   the root's own divisions: chapters, but also <frontmatter>,
               <part>, <preface>, <appendix>, <backmatter>, <worksheet>, …
splitLevel 2   …and each of those divisions' own children (a book's sections)
```

For a LaTeX import with no explicit preference, `splitLevel` comes from
`suggestSplitLevel` (`lib/latex-split.ts`): it starts from the old default (1
for a book, 0 for an article) and goes deeper while the document — or one of
its divisions — is still large and the next level has at least three divisions
to split into. A thirty-section article no longer lands in one file. Markdown
and PreTeXt imports keep the old default, since the heuristic reads LaTeX
sectioning commands. The older `splitChapters`/`splitSections` booleans still
work and are resolved against the document kind by `resolveSplitLevel` —
`splitSections` means depth 2 in a book but depth 1 in an article, since an
article's sections _are_ its top level.

The **native (LaTeX) pool** answers to the same number. `lib/latex-split.ts`
parses the source into a division tree over the document's own hierarchy —
whichever of `\part`, `\chapter`, `\section`, `\subsection`,
`\subsubsection` it actually uses, so an article's sections are depth 1 — and
`buildNativeDivisionPool` walks it to `splitLevel`. This replaces the previous
chapter-then-section special case (former SPEC §7 limitation).

**Changing the depth after the fact.** `relayoutImport(result, splitLevel)`
re-derives the file layout from an already-converted result: it rebuilds the
division pool and re-serializes, leaving the publication file, manifest, and
carried-over project files untouched. Nothing expensive re-runs, so a host can
offer a live split-depth control (the wizard does).

Any tag in the PreTeXt division vocabulary (`lib/pretext-divisions.ts`) is a
split point, not just `chapter`/`section` — which is what an existing project
imported from `project.ptx` actually contains. Elements that are structural but
never chunked on their own (`<introduction>`, `<conclusion>`) are deliberately
excluded.

Each extracted division:

- carries `xml:id` equal to its ref — an existing id is kept when it is
  REF_REGEX-safe and unused, sanitized with a warning when not, and generated
  otherwise (`ch-01` at the top level, `methods-sec-02` deeper down, so ids
  stay unique and self-describing);
- is replaced in its parent by `<plus:TYPE ref="…"/>`.

**File names** (`lib/pool/serialize-files.ts`): a division's children live in a
directory named after it, recursing for as many levels as were split —
`source/ch-body.ptx` + `source/ch-body/sec-one.ptx` +
`source/ch-body/sec-one/subsec-a.ptx`. Names use the community's prefixes
(`ch-`, `sec-`, `subsec-`, `app-`); divisions a document has only one of are
named for themselves (`frontmatter.ptx`, `preface.ptx`), matching the
pretext-cli template. Names only have to be unique within their own directory.

### 3.9 Asset and auxiliary routing

For a **new** project (LaTeX/Markdown/loose PreTeXt input):

- Image-like binaries (`png jpg … pdf eps ps`) → `source/assets/<basename>`
  (path flattened). TODO: Note this needs to be changed from current location,
  and image references in the converted document are still not rewritten (§7).
- `.bib` files → `source/<basename>`.
- Everything else (`.sty`, `.bbl`, `.txt`, …) is counted in the status log
  but not copied into the output project.

For an **existing** project (§3.13) none of this applies: every file keeps its
original project-relative path, so `<image source="…"/>` and the publication
file's `<directories external="…"/>` keep resolving exactly as they did.

### 3.10 Native mode ("keep as LaTeX/Markdown")

When the input was LaTeX or Markdown, the result also carries
`nativeOutputFiles` — the _cleaned_ (but unconverted) source as
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

### 3.12 Multi-root uploads (`lib/project/attach-roots.ts`)

An upload often holds several standalone documents — a `\documentclass` per
chapter is a normal way to write a book in LaTeX, since each chapter then
compiles on its own. `analyzeImportSources` picks one as the main document and
offers the rest as `extraRoots`; by default they are **attached as divisions**
of it.

Attachment happens _before_ conversion, on the source text: each extra root's
body is spliced into the main document under a heading of the chosen level. One
conversion pass still runs, macros defined in the main preamble are in scope for
the attached content, and the splitter downstream sees an ordinary single
document.

```ts
attachRoots?: RootAttachment[] | false;
interface RootAttachment {
  path: string;
  level?: "chapter" | "section"; // default: the main document's top level
  title?: string; // default: the file's \title, else its filename
  include?: boolean; // false leaves it out
}
```

- **Level** defaults to `chapter` when the main document is book-like
  (`\documentclass{book|report|memoir|…}` or it already uses `\chapter`),
  `section` otherwise.
- A file that **already opens with its own heading** at that level is not
  wrapped again.
- Each attached file's **own `\input`s are expanded first**, so a multi-file
  chapter attaches whole.
- **Macro definitions** in an attached file's preamble are hoisted into the
  main preamble; the rest of its preamble is dropped.
- `attachRoots: false` imports the main file alone, and the extra roots stay
  listed on `analysis.extraRoots` so a host can offer them later.

Every attachment is reported both as a status message and on
`result.attachedRoots`, and a path that is not in the upload produces an
`attached_root_missing` warning rather than failing the import.

Markdown has the same entry point (`attachMarkdownRoots`), but only at the top
level: `remark-pretext` maps a depth-1 heading to the document's top-level
division, so the chapter/section choice does not yet apply there.

### 3.13 Existing PreTeXt projects (`lib/project/`)

When an upload contains a `project.ptx`, it is not loose source — it is a
project, and it is imported as one.

**Reading the manifest** (`manifest.ts`). `findProjectManifest` takes the
shallowest `project.ptx` with a real `<project>` root (archives usually nest
everything under `my-book-main/`, so depth, not alphabetical order, decides).
`parseProjectManifest` re-implements the `pretext` CLI's resolution rules — the
same ones `packages/vscode-extension/src/project-manifest.ts` applies, ported
off `xml2js`/`node:path` so they run in a browser:

- a `<source>` **child element** is relative to the project root;
- a `source` **attribute** is relative to the project's source directory (the
  project-level `source` attribute, default `source`);
- neither → `<sourceDir>/main.ptx`.

`publication` and `output-dir` split the same way against the project-level
`publication` and `output` directories. Legacy v1 manifests (`<format>`,
`<source>`, `<output-dir>` as child elements) and pre-`<targets>` manifests
both parse. The import follows the first non-`standalone` target unless
`mainFile` names another.

**What is kept** (`existing-project.ts`). The document itself is rewritten: the
target's source is expanded, re-split, and written back at _its original path_.
Everything else is the author's and is copied through untouched at its original
project-relative path — the publication file, images, custom XSL, `.bib` files,
`requirements.txt`. The exceptions are narrow:

| Dropped                                                                    | Why                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------ |
| Files consumed into the document (the target source and its `xi:include`s) | They come back as rewritten source               |
| `project.ptx`                                                              | Regenerated to match the layout actually written |
| `output/`, each target's output dir, `.git/`, `node_modules/`, `.ptx/`, …  | Build output and tooling state, not content      |

**The regenerated manifest** preserves every original target — its name,
format, output directory, and `standalone` flag — and repoints the imported
target at the layout written. Targets are emitted in the v2 child-element form
(project-root-relative), the same form `renderProjectPtx` uses for new
projects, so every manifest this package produces reads the same way.

`preserveProjectLayout: false` opts out, importing the project as loose source
into this package's standard layout instead. `result.projectLayout` reports
which paths were used and whether the existing layout was preserved.

## 4. Output shapes (result contract)

Two hosts, two shapes, one intermediate model. The pipeline's real product is
a **division pool** (§4.1); each host consumes a serializer over it:

- **VS Code** → a file tree (§4.2): one file per division, `xi:include`
  hierarchy, `project.ptx` + `publication.ptx`, assets on disk.
- **pretext-plus** → a project payload (§4.3): flat division records with
  `<plus:* ref="…"/>` placeholder hierarchy, docinfo/title as project fields,
  assets as library uploads.

The shapes below are the _target_ contract; §4.4 records what the code
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
  docinfo: string; // full <docinfo>…</docinfo> element, or ""
  documentKind: "article" | "book";
  divisions: ImportedDivision[]; // exactly one isRoot; unreferenced = orphan
  assets: ImportedAsset[];
  statusMessages: StatusMessage[];
  warnings: CleaningWarning[];
}

interface ImportedDivision {
  xmlId: string; // unique; NCName-safe slug (see ref rules, §4.3)
  type: DivisionType; // "book" | "article" | "chapter" | "section" | …
  title: string; // plain text
  sourceFormat: "pretext" | "latex" | "markdown";
  content: string; // full division source, child refs as placeholders
  isRoot: boolean;
}

interface ImportedAsset {
  ref: string; // unique among divisions + assets
  fileName: string; // original basename
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
  Secondary roots either become _orphan divisions_ (present in the pool,
  referenced by nothing — pretext-plus's TOC surfaces these for placement)
  or separate `ImportedProject` results (→ separate plus projects / separate
  `project.ptx` targets in VS Code).

### 4.2 VS Code shape: file tree

What the webview posts to the host today (§6.2) and what
`buildPretextProjectFiles` produces — this shape is settled:

```ts
{
  files: Record<string, string>; // path → text content
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

pretext-plus has a dedicated import endpoint,
`POST /projects/import` → `ProjectsController#create_from_import`, verified
against the `import` branch of `PreTeXtPlus/PreTeXt-Plus`. It is **JSON, not
multipart** — the whole import (including asset bytes) travels as one
`fetch` body (see `app/javascript/controllers/react/import.jsx`) — and its
`import_params` permits strictly new rows (no `id`/`_destroy` on either
nested attribute, since an import never edits or deletes existing divisions
or assets):

```
project: {
  title, docinfo, document_type,
  divisions_attributes: [{ ref, source, source_format, is_root }],
  assets_attributes:    [{ ref, kind, title, short_description,
                           file: { filename, content_type, data } }]
}
```

`file.data` is a base64 string; the controller decodes it
(`.unpack1("m")`) into an ActiveStorage attachable. The serializer output is
a direct snake_case mirror of that shape:

```ts
interface PlusProjectPayload {
  title: string;
  docinfo: string;
  document_type: "article" | "book";
  divisions_attributes: {
    ref: string; // the division's xml:id
    source: string;
    source_format: "pretext" | "latex" | "markdown";
    is_root: boolean;
  }[];
  assets_attributes: {
    ref: string;
    kind: "file"; // imported binaries; "authored" unused by import
    title: string; // asset's original basename, duplicated...
    short_description: string; // ...into both display fields
    file: {
      filename: string;
      content_type: string; // guessed from extension, e.g. "image/png"
      data: string; // base64-encoded bytes
    };
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

The gaps recorded in an earlier draft of this section are resolved on the
`import` branch: `create_from_import` only calls `set_default_docinfo` when
`docinfo.blank?` (so an imported docinfo survives), `document_type` is a
permitted `import_params` key, and the wizard is mounted on the new-project
page (`new_project_controller.js` + `react/import.jsx`) driving this
endpoint directly — there is no follow-up PATCH.

Native mode maps better here than in VS Code: latex/markdown divisions are
first-class in the plus editor, so a native import can split at
chapters/sections into native divisions joined by `\plus{…}{…}` /
`::…{ref="…"}` placeholders instead of collapsing to one file (answers §8.4
for this host).

### 4.4 Current implementation (transition)

`ImportedProjectSuccess` (see `lib/types.ts`) — field guide:

| Field                                      | Meaning                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `files` / `assets`                         | The extracted _input_ file map (text / binary), as uploaded                                  |
| `pretextSource`                            | The full converted PreTeXt document (single string, pre-split)                               |
| `outputFiles`                              | The _project to write_: main/chapters/project.ptx/publication.ptx + routed `.bib`            |
| `outputAssets`                             | Binary assets to write (`source/assets/…`)                                                   |
| `nativeOutputFiles`                        | Optional cleaned-native alternative (`source/main.tex` or `.md`)                             |
| `sourcePath` / `sourceName` / `sourceType` | Which input file drove the import                                                            |
| `documentKind`                             | `article` \| `book` (detected or overridden)                                                 |
| `analysis`                                 | The upload survey that drove it (§3.3) — hosts build their pickers from this                 |
| `attachedRoots`                            | Extra roots folded into the main document (§3.12)                                            |
| `projectLayout`                            | Paths used for main source / publication / manifest, and whether they were preserved (§3.13) |
| `statusMessages`, `warnings`               | Diagnostics (see 3.11)                                                                       |

Errors are the union alternative `{ pretextError, statusMessages, warnings }` —
consumers discriminate with `"pretextError" in result`.

The intermediate model is implemented (`lib/pool/`): every success result
now carries `project: ImportedProject` built by `buildDivisionPool`, and
`outputFiles` is derived from it via `serializeProjectToFiles` — so both
hosts consume projections of the same pool and the webview protocol (§6.2)
keeps working unchanged. `serializeProjectToPlusPayload` produces §4.3's
payload. `buildPretextProjectFiles` remains exported for compatibility but
the pipeline no longer uses it. Still to migrate: `<plus:image ref>`
placeholder rewriting (image refs in content are untouched, §7) and native-mode
division depth (the native pool still splits at chapters/sections only, not by
`splitLevel`).

Multi-root uploads (§3.3) are resolved before the pool is built rather than
inside it: the extra roots are attached to the main document (§3.12), so the
pool still has exactly one root and no orphan divisions. The serializer's
orphan handling remains, since a pool assembled by hand may still have them.

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
  3. **Sources** — shown only when the upload leaves a real choice open:
     source-format dropdown, main-document radio list (each candidate labelled
     with its title and why it qualifies), and a row per extra root with an
     include checkbox and a chapter/section selector. A `project.ptx` is called
     out here, along with the note that its publication file, assets, and
     layout will be kept.
  4. **Review** — import summary (source, detected format, kind, file
     count, whether an existing project's layout was preserved, what was
     attached); collapsible warnings list; for LaTeX input, a "Convert to
     PreTeXt" vs "Keep as LaTeX" mode choice; expandable per-file preview
     of the output tree; Cancel / **Change Sources** / Confirm buttons
  5. Terminal — `onConfirm(result, mode)` fires; host writes the files
     (upload to pretext-plus storage, or write to disk in VS Code)

  The Sources step is skipped when the answer is not in doubt — a lone `.tex`
  file, or a `project.ptx` that names one target — but "Change Sources" on the
  review step always reopens it, so nothing is unreachable.

  Step 3 requires a two-phase engine: `prepare(file)` unpacks and surveys the
  upload into a `PreparedUpload`, and `convertPrepared(prepared, options)` runs
  the conversion with the user's answers. An engine that only implements
  `convertFile` (a host-provided pandoc bridge, say) keeps the original
  single-shot flow and never shows the step.

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
  "native") to a concrete file map and posts _that_ to the host. Keeping
  the wire protocol at the "files to write" level insulates it from the
  planned redesign of the result contract (§4, §8).

### 6.2 Message protocol (webview → host)

| Message          | Payload                                                                                                                   | Host action                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `import-confirm` | `{ mode, files: Record<path, string>, assetsBase64: Record<path, string>, sourceName, documentKind, warnings: string[] }` | pick destination, write files |
| `import-cancel`  | —                                                                                                                         | dispose the panel             |

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

- **Image references are not rewritten** for _new_ projects. Binaries are
  routed to `source/assets/`, but `<image source="…">` paths in the converted
  document still point at the original relative paths. Imports with images will
  need a path-rewriting pass (or route assets preserving directory structure).
  Existing-project imports (§3.13) do not have this problem: paths are
  preserved, so references keep resolving.
- **Asset basenames are flattened** for new projects — two images with the same
  name in different directories collide silently. (Existing projects keep their
  directory structure.)
- Only the **first author** is imported; `\and` co-authors are dropped.
- `.bib` files are copied but **bibliographies are not converted** to
  PreTeXt `<biblio>`; `\cite` handling depends on what unified-latex emits.
- **Native mode collapses to a single file** (`source/main.tex`) — the
  original multi-file structure is not preserved, and the emitted
  `project.ptx` still points at `source/main.ptx`, not the native source.
- The **tar parser is minimal**: no PAX/GNU long-name entries, no symlinks.
- **Markdown multi-file support is partial**: several `.md` roots can be
  attached to the main document (§3.12), but only at the top level, and there
  is still no include mechanism.
- **A second target sharing includes with the imported one can break.** If
  target B's source `xi:include`s a file that target A (the imported one)
  consumed, that file is not carried over and B's source is left pointing at
  it. Targets that share the _same_ source file are fine, which is the common
  case.
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
2. ~~**`pickPrimarySourcePath` re-derives the source type**~~ — _resolved:_
   `analyzeImportSources` (§3.3) classifies by extension and only sniffs
   content as a last resort, and the user can override with `sourceFormat` /
   `mainFile` either way.
3. **Hand-rolled tar parser** — keep it dependency-free, or take a small,
   maintained dependency for robustness (long names, sparse files)?
4. **Wizard native mode**: should "Keep as LaTeX" preserve the original
   multi-file layout instead of the expanded/cleaned single file? Should it
   emit a `project.ptx` with a LaTeX-source target instead of the PreTeXt
   one? _(Answered for the pretext-plus host: split into native divisions
   with `\plus{…}{…}` placeholders — see §4.3. Still open for VS Code.)_
5. **Styling strategy for React components** — Tailwind for all three (and
   require consumers to load `react.css`), or CSS-variables/unstyled with
   the host app themable? pretext-plus's stack should decide this.
6. **API surface** — `handleImportUploadFile` (browser `File`) vs
   `importProjectFromFiles` (path map). Should there be a third,
   Node-friendly `importProjectFromDisk(dir)` helper for the extension, or
   does that belong in the extension itself?
7. ~~**Where do split thresholds live?**~~ — _resolved:_ `splitLevel` (§3.8) is
   a single explicit number; `suggestSplitLevel` derives a default from document
   size and shape, so a large article does split its sections; and the wizard
   exposes the depth as a chooser on the review step rather than a checkbox on
   the upload step.
8. **Publication defaults** — chunking level 1, external/generated dirs:
   confirm these match current pretext-cli template output.
9. **Scope of `project.ptx` targets** — web + print only for _new_ projects;
   add epub or others, or keep minimal? (An imported project keeps whatever
   targets it already had — §3.13.)
10. **Attachment defaults for multi-root uploads** — everything is attached by
    default (§3.12). Should a root that looks like a slide deck, a solutions
    manual, or a `beamer` document be excluded by default instead?
11. **Versioning/publish plan** — is `@pretextbook/import` versioned with
    the monorepo's semantic-release, and does pretext-plus pin or float?

## 9. Test coverage

Vitest specs live alongside sources:

| Area              | Specs                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| LaTeX cleaning    | `clean-latex`, `clean-chunks`, `latex-preamble`, `latex-utils` (rules: `latex-style-pretext`'s `clean/`) |
| Includes          | `pretext-includes`                                                                                       |
| Detection         | `detect-source-format`                                                                                   |
| Layout / scanning | `build-project-files`, `document-kind`, `xml-scan`                                                       |
| Division pool     | `division-pool`, `native-pool`, `serialize`, `latex-split`                                               |
| Layout + diff     | `relayout`, `file-changes`, `diff`                                                                       |
| Manifests         | `project/manifest`                                                                                       |
| Pipeline          | `upload`, `import-project` (existing projects, §3.13), `import-multi-root` (§3.12)                       |

The React components have no automated tests yet — the playground smoke page
(`packages/playground/import-smoke.html`) is the manual harness.

The monorepo root `npm test` runs this package's suite as part of
`test:libraries`; `npm run test -w @pretextbook/import` runs it alone.
