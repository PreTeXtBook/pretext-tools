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

- Image-like binaries (`png jpg … pdf eps ps`) → `<sourceDir>/<external>/<basename>`,
  where `<external>` is the publication file's `<directories external="…"/>`
  (`external` by default, matching the publication file this package generates;
  `externalDir` overrides it for a host inserting into a project of its own).
  PreTeXt resolves `<image source="…"/>` against that directory, not against the
  source file, so the files and the references have to agree: paths are
  flattened to basenames, collisions deduplicated (`plot-2.png`), and every
  `@source` on `<image>`/`<video>`/`<audio>` is rewritten to match
  (`lib/assets/images.ts`). Matching is by basename — the document says
  `figures/plot.png`, the archive held it at `chapters/figures/plot.png`, and
  the basename is the part they agree on. A reference the upload cannot satisfy
  is left as written and warned about.
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

Which of the two the review step _starts_ on is the host's call, not the
wizard's: `defaultImportMode` (§4, §5) takes `"converted"` (the default) or
`"native"`, and `lockImportMode` hides the chooser for a host that supports
only one. The choice is offered for every result that carries a native
projection — Markdown as well as LaTeX — and hidden for PreTeXt input, which
has nothing to keep.

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

### 4.3 Record shape: a flat, ref-addressed projection

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

The same module owns the mode _policy_ each host configures against:
`DEFAULT_IMPORT_MODE` (`"converted"`), `hasNativeImportMode(result)` (does
this result carry a native alternative at all?), and
`resolveImportMode(result, preferred)`, which collapses a preferred
`"native"` to `"converted"` when there is no native projection. Hosts should
resolve before reporting or storing a mode: the `*ForImportMode` helpers fall
back silently, so an unresolved preference can name a style whose files were
never written.

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
     attached); collapsible warnings list; for LaTeX and Markdown input, a
     "Convert to PreTeXt" vs "Keep as LaTeX/Markdown" mode choice starting on
     the host's `defaultImportMode`; expandable per-file preview
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

## 9. Importing into an existing project

Everything above assumes the import creates a _new_ project. In practice the
more common need is the opposite: an author already has a PreTeXt document open
and wants to bring outside material into it. Three stories drive the design.

1. **Inline.** Writing in PreTeXt, wanting to add an exercise that exists as
   LaTeX. Copy-paste followed by a conversion step is two moves; the wanted
   thing is one — the converted markup arrives where it was pasted. Works for
   LaTeX and Markdown, which are text; not for Word, which is not.
2. **One division.** A homework set in a LaTeX file that should become a
   `<subsection>` of the current document, `xi:include`d (or referenced by
   `<plus:subsection>` on pretext-plus) rather than inlined. Opening the file
   to select the right text by hand is the friction; "insert the contents of
   this file" is the operation.
3. **Many divisions.** The same, but pulling a collection of quizzes out of a
   larger project — a batch insert yielding one file per section, or per
   whatever division the author asks for.

All three are expected to outrank new-project import by frequency. New-project
import remains important in its own right, particularly as pretext-plus's
document provisioner.

### 9.1 Two mechanisms

The stories collapse into two, not three. Story 1 is a _text_ operation whose
unit is content — an exercise, some paragraphs — with no files, no includes and
no division structure. Stories 2 and 3 are one mechanism at two settings of a
dial that already exists: the review-step `splitLevel` and `relayoutImport`
(§3.8) already turn one upload into "one file per division at depth N". Story 2
is that dial at its coarsest.

|          | Story 1                  | Stories 2–3                     |
| -------- | ------------------------ | ------------------------------- |
| Input    | clipboard text           | file or archive                 |
| Formats  | LaTeX, Markdown          | anything, incl. Word via pandoc |
| Unit     | inline content           | divisions                       |
| Output   | markup at the cursor     | new files + one include         |
| Pipeline | none — direct conversion | the full pipeline (§3)          |

### 9.2 Destination: unifying new-project and insertion

Both existing call sites — `importProjectFromFiles` and `relayoutImport` — run
the same seam:

```ts
buildDivisionPool(pretextSource, { documentKind, splitLevel, assets })
  → serializeProjectToFiles(pool.project, { …paths, includeScaffold })
```

Everything _before_ that seam is shared by both destinations and does not move:
multi-file uploads, root selection (§3.3), attachment (§3.12), cleaning (§3.5),
split-depth resolution (§3.8). The seam is where the destination enters:

```ts
export type ImportDestination =
  | { kind: "project" }
  | {
      kind: "insert";
      /** Division level the imported root becomes (`subsection`, …). */
      targetTag: PretextDivisionTag;
      /** Every xml:id already live in the host project. */
      takenIds: ReadonlySet<string>;
      /** Directory of the file receiving the include; new files land beside it. */
      hrefBase: string;
    };
```

It enters on **both** sides of the seam, not just the serializer, because the
two transforms of §9.3 have to run while the document is still one string:

```ts
prepareInsertSource(pretextSource, destination) // insert only
  → buildDivisionPool(source, { …, takenIds })
  → serializeForDestination(pool.project, destination, { layout, unwrapRoot })
```

`serializeForDestination` returns `{ files, includes, pathByRef }`. The
`project` branch is the current behaviour unchanged — scaffold on, `project.ptx`
and a publication file emitted (§4.2), `includes` empty because a new project
writes its own includes into its main file. The `insert` branch writes only
source files, beside the file receiving the include, and returns the
`<xi:include>` elements the host splices in.

`includes` is a list rather than the single element this section first
specified: a titleless document that is nothing but divisions contributes one
per division (see the unwrap rule below). Nor does the `project` branch carry a
`layout` — the result already has `projectLayout`, and duplicating it invites
the two to disagree; the paths are passed as serializer options instead.

**The wrapper: dropped or kept.** A converted document always has a
`<book>`/`<article>` wrapper, but whether that wrapper _means_ anything depends
on the source. A LaTeX file that is one `\section{Homework 3}` converts to a
wrapper around a single titled division; the wrapper is an artifact of
conversion, and keeping it inserts an empty, untitled level above the homework.
A file with `\title{Homework 3}` and prose beneath converts to a wrapper that
carries the title itself, and dropping it throws that title away. The `<title>`
is what separates the two, so it is what `shouldUnwrapRoot` keys on: a wrapper
with a title of its own survives as the inserted division; a titleless wrapper
whose children are all divisions is scaffolding and is dropped. (A titleless
wrapper holding loose prose is neither — there is nothing to unwrap _to_ — so it
survives, with a warning that the division it became needs a title.)

Dropping the wrapper makes its children the units being inserted, and a unit
with no file of its own never arrives, so unwrapping forces a split floor of 1
(`minimumInsertSplitLevel`) however the split dial is set.

**Ids the pool mints.** `dedupeXmlIds` settles the ids a document already
carries, but the pool mints more — `sec-01` for a division that had none — and
those are created after it has run. `buildDivisionPool` therefore takes
`takenIds` too and seeds its `RefPool` with them, so a generated fallback cannot
collide with the host either. For the inserted units themselves the fallback is
not merely unique but wrong: `subsec-01.ptx` reads fine in a project the import
created and says nothing in a project that already exists. `prepareInsertSource`
names those units after their titles instead (`subsec-homework-3.ptx`), leaving
deeper divisions to the pool, whose fallbacks are already scoped by their parent.

`ImportProjectOptions` gains an optional `destination`, defaulting to `project`,
so existing callers are unaffected. The result carries `destination` back, plus
an `insert` record (`unwrapRoot`, `includes`, `renamed`, `retargetDelta`,
`preparedSource`, `warnings`) for hosts to surface.

`result.pretextSource` stays the raw conversion for both destinations; the
prepared source lives on the insert record. The attach level is a control the
author can move _after_ converting (§9.4), and re-preparing an already-prepared
source would shift an already-shifted document a second time — the second move
would land nowhere near what was asked for. Both live controls therefore restart
from the conversion:

```ts
rebuildImport(result, { splitLevel?, targetTag? });
relayoutImport(result, splitLevel); // = rebuildImport(result, { splitLevel })
retargetImport(result, targetTag); //  = rebuildImport(result, { targetTag })
```

A rebuild _replaces_ the warnings from the stages it redid rather than adding to
them, which is what `result.rebuiltWarnings` is for: trying three attach levels
should leave one overflow notice, not three.

> **`relayoutImport` must carry the destination too.** It is what the wizard's
> split dial calls. A version that does not know the destination would silently
> regenerate scaffold files the moment an author changed the split level during
> an insertion. It reads the destination off the result rather than taking it as
> an argument, so a caller cannot forget it.

Insertion is therefore not a second pipeline. New-project import becomes the
case where the destination is `project`; it is _not_ merely "the imported root
is the document root", because that branch is also what emits the manifest and
publication file and what absorbs a multi-file upload.

### 9.3 Retargeting and collisions

A converted fragment's top-level element reflects its _source_, not its
destination: `\section` yields `<section>`, a Markdown `#` yields `<chapter>`.
Attaching at a chosen level therefore means shifting every division tag.

```
DIVISION_LADDER = [part, chapter, section, subsection, subsubsection]
```

`retargetFragment` (`lib/insert/retarget.ts`) computes
`delta = depth(targetTag) − depth(topTag)` and shifts each ladder tag. `topTag`
is the _shallowest_ ladder tag anywhere in the fragment, not whichever comes
first, which buys an invariant: every other tag is at least as deep, so nothing
is ever promoted above `targetTag`. Inserted content can only nest inside its
attachment point — it can never climb out and restructure the host document.
Two rules:

- Tags off the ladder (`<exercises>`, `<appendix>`, `<worksheet>`) pass through
  untouched — they are not depth-indexed.
- Anything pushed past `<subsubsection>` becomes `<paragraphs>`. This is not a
  warning case, just the rule; `<paragraphs>` is deliberately absent from
  `PRETEXT_DIVISION_TAGS` (§4.1), so overflow content stays inline and can never
  be split into a file of its own. The overflow rule and the splitter agree
  without either referring to the other.

`dedupeXmlIds` (`lib/insert/dedupe-ids.ts`) renames any id already live in the
host project — or invalid as a ref — reusing `sanitizeRef` (§4.1) and reporting
the renames so the host can surface them. It also rewrites the fragment's own
`ref`/`first`/`last` attributes, so an `<xref>` follows its target rather than
dangling: fixing one document must not break the fragment inside it.

Both transforms are whole-fragment and pre-split — they run on the converted
source _before_ `buildDivisionPool`, not on a built pool. Two reasons. A
reference can only follow a rename while the `xml:id` declaring it is in the
same string, and once the pool has split the document a parent holding
`<plus:subsection ref="…"/>` can no longer see what it names. And retargeting
first is what makes the overflow rule and the splitter agree: `<paragraphs>` is
already in place by the time the splitter looks for divisions to lift out.
In VS Code the taken set comes from the LSP server's `getReferences()`, which
already walks the project from its main source through every `xi:include`.

### 9.4 Host wiring

**VS Code.** Insertion point comes from `parseOutline` over the active document:
the innermost division containing the cursor, whose child level is the target.
Files are written as siblings of the including file — an author who wants them
elsewhere can move them. The write and the include splice go into one
`WorkspaceEdit` so the insertion is a single undo. When the workspace holds no
project, the mode switch is skipped and `project` is the only destination.

**The wizard.** `ImportWizard` takes an `insertTarget` prop — the host's offer:
the document's label, the level derived from the cursor, the levels on offer,
the project's live `xml:id`s, and the `hrefBase`. Only the host knows any of
that. Given it, the wizard adds an attach-level control beside the split dial on
the review step, working the same way: it rebuilds the converted result rather
than re-importing, so the file tree and the rename list update as the author
tries levels. The levels offered run from the cursor's own level downwards —
never shallower, since a division shallower than its container cannot nest
inside it. Import mode is locked to "converted" for an insert: native mode
writes the cleaned LaTeX or Markdown source, which a PreTeXt document cannot
include.

VS Code reaches it through the same panel: `cmdImport` asks where the material
goes, and an insert opens the wizard with an `insertTarget` instead of the
folder-writing flow. The receiving document and the attachment point are
captured _before_ the panel opens and held for the life of it — the author may
look at other files while reviewing, and a confirmed import must land where they
said rather than wherever the cursor has since wandered. Both paths converge on
one `applyInsertToDocument`, so the single `WorkspaceEdit`, the namespace, and
the overwrite check are written once.

**A hosted consumer.** `hrefBase` is unused: the pool is flat, so insertion appends
division rows and writes a `<plus:subsection ref="…"/>` placeholder into the
parent division's source. `serializeProjectToPlusPayload` (§4.3) already emits
placeholders unchanged, so no new projection is needed.

### 9.5 Story 1: paste and convert

Independent of everything above. The extension's `cmdConvertText` already
converts a _selection_ in place, with
schema validation (`collectPtxSchemaViolations`) and context-aware
reindentation. What is missing is the paste half:

- the clipboard as a source, rather than only the selection;
- a `registerDocumentPasteEditProvider` entry, so pasting LaTeX into a `.ptx`
  file offers "Paste as PreTeXt" in the paste widget;
- a _positional_ validity check — pasted LaTeX containing `\subsection` yields a
  `<subsection>`, which is illegal mid-paragraph. The schema check should ask
  what is legal at the cursor, not in the abstract.

That API is stable only from VS Code **1.97**, so `engines.vscode` moves from
`^1.89.0`. Later, this path could adopt `convertSourceToPretext` to gain the
cleaning pass and warnings (§6.4).

**Detection is the hard part, and it is not `detectSourceFormat`.** That
function answers "is this _file_ a LaTeX document?", keying on document
furniture — `\documentclass`, `\begin{document}`, `\section` — none of which
survives into a fragment copied from the middle of one. Measured against
realistic clipboard contents it reported `pretext` for `Let $G$ be a
\emph{group}`, for `\[ \int_0^1 x^2\,dx \]`, and for a Markdown bullet list, so
every such paste went through unconverted.

`detectSnippetFormat` (`lib/detect-snippet-format.ts`) answers the snippet
question instead: it scores the grain of the markup — math delimiters, backslash
commands, bullets, emphasis runs, fences — and returns a format only when the
winner clears a floor, so a single weak hint is not enough. Guessing wrong
mangles text an author meant to keep verbatim, while declining is free because
the caller simply pastes plainly. Inline math is guarded against currency
(`costs $5 and $7` is not math), and ties go to LaTeX, the two languages
overlapping mainly on `*` and `_`.

**Placement is shared; the host binding is not.** Conversion answers what the
snippet becomes; `lib/paste/place-markup.ts` answers what has to change for it
to sit at the cursor — unwrapping the converter's own `<p>` when the insertion
point is already inside one, supplying the `<p>` when it is not, reindenting to
the surrounding line, and reporting block content that lands mid-paragraph,
which cannot be repaired here and so is inserted with a warning rather than
silently mangled. That is pure string work, so it lives in this package: VS
Code's `DocumentPasteEditProvider` and pretext-plus's Monaco paste handler each
read the placement context out of their own editor and then call the same
`placeConvertedMarkup`. `isInlineContext` serves the insert path too (§9.2),
which needs the same "is the cursor inside a paragraph?" answer before placing
an `xi:include`. What stays host-side is the binding and the log line — the
extension's `describeDetection` only means something where there is an output
channel to write it to.

**Wrapping cannot be left to the converter.** `unified-latex` wraps paragraphs
only when the source has more than one of them, so the commonest paste there is
— one paragraph of prose — converts to bare text with no `<p>` at all, and
`Intro \begin{theorem}…\end{theorem} outro` converts to text on either side of a
block with no paragraph around either. Both are invalid anywhere the cursor is
not already inside a `<p>`. `wrapLooseParagraphs` supplies the missing ones by
the schema's own rule: a top-level element the `<p>` content model admits joins
the paragraph being accumulated (`<m>`, `<em>`, and equally `<md>` and `<ol>`,
which are `TextParagraphItem`s and belong *inside* a paragraph), and one it does
not — `<theorem>`, `<pre>`, a division — ends the run and passes through
untouched. The element list is lifted from the generated
`default-dev-schema.ts`, and `place-markup.spec.ts` fails if a schema refresh
moves it. Markup that arrives correctly wrapped is unchanged by the pass, which
is what lets it run unconditionally on the block-context path — and lets the
extension run it *before* the formatter, so a pasted paragraph is reflowed like
any other rather than landing as one long line.

### 9.5b Cherry-picking divisions

The pipeline took a document whole until now; `attachRoots` (§3.12) selects
among _roots_, not among the divisions inside one. Pulling three quizzes out of
a semester's worth of them is what step 6 adds.

**A selection is a prune of the converted source**, run before anything else
looks at it — before the retarget, before the pool:

```ts
outlineDivisions(pretextSource) → DivisionOutlineItem[]   // what a picker renders
pruneDivisions(pretextSource, selection) → { source, removed }
```

Pruning the division _pool_ instead would tie what an author may select to
`splitLevel` — you could only pick divisions the splitter happened to lift into
files — and would leave the retarget measuring a document that is no longer the
one being imported.

Divisions are addressed by **`DivisionPath`**: the index among siblings, joined
by dots (`"2"`, `"2.0"`). Positional rather than by `xml:id` because most
converted documents have no ids yet — the pool mints them downstream — and an
address that only worked for well-labelled documents would be no use on exactly
the imports that need it.

What a selection keeps: the picked divisions whole, subdivisions included; the
divisions containing them, as the structure they hang from; and any content
belonging to a kept division but to none of its subdivisions, which is the
parent's own and was never deselected. An absent or empty selection expresses no
narrowing and prunes nothing — a host that wants "import nothing" should not run
an import.

**A selection forces the insert unwrap (§9.2).** Normally a titled `<article>`
wrapper _is_ the document and becomes the inserted division. Once the author has
picked three of its sections, the wrapper is instead the container they picked
_from_, and keeping it would insert a level nobody asked for; three picks should
yield three sibling divisions, which is story 3. The wrapper's own title and any
loose text are dropped with it, and that is warned about rather than done
quietly.

**A selection also forces converted mode.** The prune operates on the converted
PreTeXt; the native projection (§3.10) is built from the cleaned LaTeX or
Markdown, which the prune never saw. The two cannot both be honoured, so the
selection — expressed explicitly by the author — wins, and the native option is
withdrawn while one is active.

`reselectImport(result, selection)` is the third live control, alongside the
split dial and the attach level, and restarts from `result.pretextSource` for
the same reason they do: a picker built from the last prune's output could only
ever narrow, never widen — a one-way door.

### 9.5c Naming: records, not "plus"

The flat, ref-addressed projection is not specific to pretext-plus — it is what
any host that stores divisions in a database wants, as against the file tree a
filesystem host wants. So it is named for what it is:

| Layer                                          | What it is                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `serializeProjectToRecords` → `ProjectRecords` | The projection. camelCase, consumer-neutral.                       |
| `serializeInsertToRecords`                     | The same for an insert: new rows plus placeholders (§9.4).         |
| `recordsToPlusPayload` → `PlusProjectPayload`  | A thin adapter renaming fields for one endpoint's `import_params`. |

`serializeProjectToPlusPayload` remains as the composition of the two, so the
existing call sites are unaffected. The Rails-shaped names stay on the adapter
because they describe a specific endpoint; a second hosted consumer writes its
own adapter beside it rather than inheriting field names it has no use for.

**The `<plus:TYPE ref="…"/>` placeholder syntax is deliberately left alone.** It
is not an internal detail this package is free to rename: pretext-plus stores it
verbatim, so it is an interchange format with a system this repository cannot
see. Renaming it is a coordinated change, not a tidy-up.

### 9.6 Sequencing

| #   | Work                                                                                 | Story |
| --- | ------------------------------------------------------------------------------------ | ----- |
| 1   | ✅ Paste-and-convert: clipboard, paste provider, engine bump                         | 1     |
| 2   | ✅ `retargetFragment` / `dedupeXmlIds` (pure)                                        | 2, 3  |
| 3   | ✅ `ImportDestination` + `serializeForDestination`; threaded through both seam sites | 2, 3  |
| 4   | ✅ VS Code insert path + new-project/insert mode switch                              | 2, 3  |
| 5   | ✅ Wizard attach-point step; destination-aware `relayoutImport`                      | 2, 3  |
| 6   | ✅ Division cherry-picking — importing a _subset_ of a larger project                | 3     |
| 7   | ✅ Hosted-consumer parity (records projection for inserts)                           | 2, 3  |
| 8   | ✅ Images                                                                            | all   |

Step 1 blocks on nothing and is the most frequent story, so it goes first.
Steps 1–5 deliver all three stories; step 6 is the only genuinely new
capability, since the pipeline currently takes a document whole.

### 9.7 Known gaps

- **Images from the remote pandoc endpoint.** The local binary extracts a
  document's own figures with `--extract-media` (`pandocToPretextWithMedia` in
  the extension), so a Word import in VS Code carries its images. The remote
  `/pandoc/` endpoint cannot: it answers `text/plain` and has nowhere to put
  them. Carrying media back needs a zip response mode on the server, as its
  build endpoint already grew. Until then a remote pandoc import converts the
  text and warns about every figure it could not find.
- **Cherry-picking and native mode** are mutually exclusive (§9.5b): the prune
  runs on the converted PreTeXt, so keeping the original LaTeX or Markdown
  imports the document whole. Pruning the native source would need division
  addressing in each source language.
- **Story 1 and Word.** Binary formats cannot be pasted as text; that case is
  story 2 by construction.

## 10. Test coverage

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
| Insertion         | `insert/retarget`, `insert/dedupe-ids` (§9.3), `insert/insert-destination` (§9.2, end-to-end)            |
| Cherry-picking    | `select/divisions`, `select/select-import` (§9.5b, end-to-end)                                           |
| Paste placement   | `paste/place-markup` (§9.5)                                                                              |
| Images            | `assets/images` (§3.9, unit + end-to-end)                                                                |
| Record projection | `pool/serialize-insert-records` (§4.3, §9.4)                                                             |

The React components have no automated tests yet — the playground smoke page
(`packages/playground/import-smoke.html`) is the manual harness. That gap now
covers the wizard's attach-level control (§9.4); the rebuild it drives
(`retargetImport`) is unit-tested, but the control itself is not.

The monorepo root `npm test` runs this package's suite as part of
`test:libraries`; `npm run test -w @pretextbook/import` runs it alone.
