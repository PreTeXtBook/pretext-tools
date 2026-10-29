# @pretextbook/pretext-html

## 0.19.0

### Minor Changes

- dfd5c08: Add `rewriteAssetUrlsAsync` to the `assets` subpath: the same asset-URL retargeting as `rewriteAssetUrls`, for a resolver that has to look the file up asynchronously first. The page is scanned once rather than twice.

## 0.18.1

### Patch Changes

- eb26267: Sync PreTeXt schemas and XSL to pretext-cli v2.56.1 (core commit da19341).

## 0.18.0

### Minor Changes

- 63414d1: Build previews with PreTeXt's CDN resource host instead of portable HTML, so latex-image and PreFigure SVGs are linked rather than inlined.

  - The preview publication now forces `<html><resources host="cdn"/>`, `<common><chunking level="0"/>`, `<html><cross-references knowled="never"/>` and `<html><platform portable="no"/>`. The page is otherwise the same as before: one page, CDN css/js, cross-references as links, and the search index embedded. The difference is that generated SVGs are `<img src="generated/latex-image/…">` links, which a host retargets with `rewriteAssetUrls` like every other asset. Nothing reads image files during the render any more, which is what a browser host without a filesystem needs.
  - `RenderResult.assetDirs` follows PreTeXt's current rules and is always present. `external` comes from the document's `<docinfo><directories external="…"/>` first and the publication file second, and is absent when neither declares it. `generated` defaults to `generated/` beside the main source. Projects that declare external in the docinfo and generated in the publication file, as PreTeXt's own samples now do, previously got no `assetDirs` at all.
  - Breaking: `assetDirs.external` is now optional, and `AssetDirectories.managed` is gone, since managed directories are PreTeXt's only scheme. `readAssetDirectories()` takes the docinfo's `@external` as a second argument, and the new `docinfoExternalDirectory()` reads it from a document.
  - `forcePortablePublication` is renamed `forcePreviewPublication`. The old name remains as a deprecated alias.
  - Hosts should version each asset URL (a modification-time query, say), because a page never refetches an image whose URL is unchanged. The README's new "Images and other assets" section covers this, and a live patch updates a changed `src` in place.
  - The CLI's `--output` file links each asset relative to itself, with a placeholder for missing ones, so the page still opens with its images. Output on stdout keeps PreTeXt's own URLs.

## 0.17.0

### Minor Changes

- bd9236d: Preview one division of a large document instead of all of it, and stop re-parsing what has not changed.

  - `renderHtml({ subtree })` previews the division around a cursor (`file`/`line`) or carrying an `id` of a complete document, numbered and cross-referenced as the whole document would be. A division that contains divisions is shown as a summary page — its own content, then links to the divisions inside it — so only leaf divisions render in full and a cursor at the top of a book shows the book's front matter and a table of chapters, not the book. `level` picks the page by PreTeXt's chunk-level rules instead (a division at the chunk level is shown whole), and `wholeDocumentUpTo` keeps small documents previewing whole. With `fragment` plus a context document, `subtree` narrows the preview within the placed fragment. Inert links on a one-division page now carry `data-ptx-division` / `data-ptx-id`, so a host can turn a summary link into "show that division".
  - `measureDocument()` reports a document's size (elements, bytes, files spanned) without rendering, and every `RenderResult` now carries `size` and, when one division was emitted, `subtree`.
  - `readSource` / `files` supply a project's files from memory, so the browser build resolves `xi:include`s itself and an editor can render unsaved buffers of included files.
  - A per-file parse cache (`SourceCache`, on by default) means a keystroke re-parses only the file being edited; the rest of the book is reused whatever way it is chunked into files.
  - The skeleton a division is previewed in is far leaner: shells of other divisions are kept only to the table of contents' depth and along the previewed division's ancestry, which on a thousand-subsection book cuts a section preview from 1.5s to about 0.25s. It also now numbers correctly where it did not: the blocks of preceding sibling divisions within the numbering scope are counted (so previewing subsection 3.2.4 numbers its theorems after those of 3.2.1–3.2.3), a cross-reference target is numbered within its whole numbering scope, a target's enclosing chapter is no longer kept verbatim, and a target in an ancestor's introduction no longer strips the previewed division's prose. The depths come from the publication file (`tableofcontents/@level`, `numbering/*/@level`), defaulting as PreTeXt does.
  - The source map now attributes a placed fragment's elements to the fragment's own file.

## 0.16.1

### Patch Changes

- 1f8e8f7: Sync PreTeXt schemas and XSL to pretext-cli v2.55.0 (core commit ee0a7e1).

## 0.16.0

### Minor Changes

- bfbeb5d: Add `patchDocument`, `typesetPatch` and `livePatchScript` (also published as
  the dependency-free `@pretextbook/pretext-html/live-patch` subpath) for
  updating a preview that is already on screen in place.

  Replacing a rendered page on every re-render blanks it, re-runs its scripts
  and has MathJax typeset the whole document again, so the preview flashes and
  loses its scroll position. `patchDocument` instead diffs the previous render
  against the new one and changes only what differs in the live page: identical
  blocks are left alone (typeset math, opened proofs and Runestone state
  survive), blocks whose auto-generated ids merely shifted are updated in place,
  and changed blocks are replaced. `typesetPatch` then has MathJax typeset just
  the replaced blocks.

  It declines — leaving the page untouched, so the caller can fall back to
  replacing it — when something changed that only works on a fresh load: the
  page head, a script, a Runestone exercise, or the LaTeX macros.
  `livePatchScript` serializes both functions into an inline script for
  embedders whose page runs in a separate context, such as a VS Code webview.

## 0.15.0

### Minor Changes

- e2b6d96: Improved import features

## 0.14.0

### Minor Changes

- 9543e76: Many minor improvements to conversion and import

## 0.13.0

### Minor Changes

- 7749353: Improve latex support

## 0.12.0

### Minor Changes

- 40dd00b: Improve cleaning of suspect latex

## 0.11.0

### Minor Changes

- 3acaf89: Add print preview for live preview

## 0.10.1

### Patch Changes

- d537383: Updates to latex-to-pretext

## 0.10.0

### Minor Changes

- f179033: Tweaks to make pretext.plus happy

## 0.9.0

### Minor Changes

- 6678cc6: Improvements to import and live preview features

## 0.8.0

### Minor Changes

- 876c474: Updates to pretext, improvements to latex-style linting, and preview of runestone components

## 0.7.0

### Minor Changes

- ccb0deb: Add banner message for live preview, update validations and completions"

## 0.6.0

### Minor Changes

- fcabaca: Gray out print previews and expand knowls

## 0.5.0

### Minor Changes

- 1e6666b: Release slide previews

## 0.4.0

### Minor Changes

- f5df6ac: Add a `cssTheme` render option (`--css-theme` on the CLI) that supplies the
  PreTeXt HTML theme via `<html><css theme="…"/></html>` in the publication file
  used for the build. It applies only when the project's own publication file
  names no theme, so a book that has chosen one still previews in it.

## 0.3.0

### Minor Changes

- b42ffd9: Add asset/image support

### Patch Changes

- b42ffd9: Fix corruption when renders overlap, and stop misreporting it as a size limit.

  `renderHtml` was not reentrant: it drives a single cached compiled stylesheet
  through a patched `globalThis.fetch` and shared mount tables, and it suspends
  mid-transform to fetch stylesheets — exactly the window in which a second
  render could run. Overlapping renders interleaved inside libxslt and corrupted
  it. `renderHtml` now queues concurrent calls; each still resolves with its own
  result, and a rejected render does not stall the queue.

  The failure was very hard to diagnose from its symptoms, so the error mapping
  changed too. A collision surfaces as an out-of-bounds memory fault, which was
  reported as "the document is too large … (stack overflow)" regardless of the
  document's actual size — sending people off to measure documents that were
  often only a few hundred bytes. That message now names both possible causes
  rather than asserting the less likely one. And because the WASM instance is
  terminally aborted after such a fault, every later call failed with an
  unrelated pthread mutex assertion; that state is now detected and reported as
  what it is, with the instruction to restart the process or reload the page.

  Callers driving a UI were the most exposed: React's StrictMode double invokes
  mount effects, so a preview component rendering on mount reliably poisoned the
  renderer on the very first paint.

## 0.2.0

### Minor Changes

- 1804e00: Add a browser build, so PreTeXt can be rendered to HTML client-side with no
  server and no Python.

  Bundlers pick it up automatically through the new `browser` export condition.
  `renderHtml` keeps the same signature; in the browser `sourceContent` is
  required (there is no filesystem) and `xi:include`s must be pre-merged. The
  stylesheets are fetched from a version-pinned jsDelivr copy by default, so
  embedders need no build configuration; `setAssetsBase()` self-hosts them and
  `setMountReader()` allows arbitrary delivery.

  Internally, everything that touches the outside world moved behind a platform
  seam (`src/host.ts`), and the browser build substitutes a posix-only
  `node:path` — sound because `FILESYSTEM=0` means no path this package computes
  ever reaches a real filesystem. The browser bundle contains no `node:` imports.

  Cold renders now cost two requests instead of ~32: the new
  `assets/xsl-bundle.json` packs the whole stylesheet closure — 13 stylesheets
  plus the 17 locale files `pretext-common.xsl` eagerly loads — into one file. It
  is recorded from a real render (static `xsl:import` analysis under-collects),
  and is purely an optimisation: a missing bundle falls back to per-file fetches.

- 1804e00: Make more robust for html consumers
