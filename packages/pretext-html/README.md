# @pretextbook/pretext-html

Convert [PreTeXt](https://pretextbook.org) documents to HTML in pure
JavaScript — no Python, no PreTeXt installation. This runs the **official,
unmodified PreTeXt XSLT stylesheets** with
[`@pretextbook/libxslt-wasm`](https://github.com/oscarlevin/libxslt-wasm), a
WebAssembly build of libxml2/libxslt/libexslt (the same C libraries the Python
CLI uses via lxml), so the HTML matches a real `pretext build`. It is a fork of
[jeremy-code/libxslt-wasm](https://github.com/jeremy-code/libxslt-wasm) built
with a larger WASM stack so whole-book documents render without overflowing
(see [Forking libxslt-wasm](#forking-libxslt-wasm)).

The output is a single, standalone HTML page. The theme css/js and MathJax
load from public CDNs, the whole document is rendered as one page, and images
are linked rather than embedded, so the host serves them from wherever it
keeps them (see [Images and other assets](#images-and-other-assets)). This is
what powers the "Live Preview" in the PreTeXt-tools VS Code extension, and it
is published so other tools (e.g. pretext.plus) can render previews the same
way.

## Usage

### CLI

```sh
npx @pretextbook/pretext-html source/main.ptx \
  --project-dir . \
  --publication publication/publication.ptx \
  -o preview.html
```

HTML goes to stdout (or `--output`); diagnostics (`PTX:WARNING`, `PTX:ERROR`,
deprecation notices) go to stderr. Run `pretext-html --help` for all options.

The CLI relaunches itself with `--experimental-wasm-jspi` automatically (see
[Requirements](#requirements)).

### API (Node)

```js
import { renderHtml } from "@pretextbook/pretext-html";

const { html } = await renderHtml({
  sourcePath: "source/main.ptx", // root document
  projectDir: ".", // directory the transform may read from
  publicationPath: "publication/publication.ptx", // optional
  stringParams: {}, // optional extra XSLT stringparams
});
```

- `sourceContent` lets you render unsaved editor text (with `sourcePath` still
  anchoring relative `xi:include`s).
- `fragment: true` renders a non-root file (a lone `<section>`, `<chapter>`, …)
  by wrapping it in a minimal `<pretext>` document. To keep the project's LaTeX
  macros and custom settings, give it the docinfo: either `docinfoSourcePath`
  (the project main file, whose `<docinfo>` is lifted out — resolving
  `xi:include`s, including a docinfo that is itself included), or `docinfo` (a
  `<docinfo>` element as a string, if you already have it). Both are ignored
  for complete documents, which carry their own docinfo.
- `sourceMap: true` additionally returns a **source map** for editor/preview
  sync: one entry per element, in document order, mapping the element's HTML
  id to the source `file`/`line` it was authored in — through `xi:include`s.
  This works because HTML ids are the `@unique-id` values that
  `pretext-assembly.xsl` stamps with a deterministic walk
  (`@label ?? @xml:id ?? parent-id + "-" + sibling-position`), which is
  replicated over the merged tree in JS; the rendered page itself is
  unchanged. Entries carry a `parent` id so clients can fall outward when an
  element has no HTML id of its own, and `findSourceMapEntry(entries, line)`
  picks the element nearest a cursor line. (This powers the two-way sync in
  the VS Code Instant Preview; the same map works for any embedder.)
- The user's publication file is respected, except for four settings that
  single-page in-memory output needs, which are always forced (see
  `src/publication.ts`):
  - `<html><resources host="cdn"/>`: css/js, theme and icon font from the CDN.
  - `<common><chunking level="0"/>`: the whole document on one page.
  - `<html><cross-references knowled="never"/>`: cross-references are links,
    because the knowl files they would open are never written.
  - `<html><platform portable="no"/>`: PreTeXt's _portable HTML_ mode is off,
    even for a project that builds portable. Portable mode would do the first
    three as well, and earlier releases relied on it, but it also inlines
    every latex-image and PreFigure SVG into the page. Without it those are
    linked like every other image. The search index stays embedded in the
    page, as portable mode had it.
- `cssTheme: "denver"` supplies the PreTeXt HTML theme for projects that do not
  choose one, by adding `<html><css theme="…"/></html>` to the publication file
  used for the build (including the minimal one synthesized when you pass no
  `publicationPath`). It is a default, never an override: a publication file
  that already names a theme — `@theme`, or the deprecated `@style`/`@shell` —
  keeps it, so the preview goes on matching what `pretext build` produces. The
  themes the bundled stylesheets know are `default-modern` (PreTeXt's own
  default), `denver`, `tacoma`, `salem`, `greeley` and `boulder`; the preview
  loads `theme-<name>.min.css` from the CDN, so an unrecognised name gives an
  unstyled page. Not to be confused with `theme` below, which is the
  light/dark mode _within_ whichever css theme is in force.
- The compiled stylesheet is cached per `xslDir` (~1s to compile, then
  ~100ms–1s per render depending on document size).
- `theme: "dark" | "light" | "system"` makes the preview follow the embedding
  app's light/dark theme (see [Theme control](#theme-control)).
- Born-hidden knowls — solutions, hints, answers, and any block the publication
  file elects to hide — are rendered **expanded**, because these pages are
  previews: an author editing a solution would otherwise watch it collapse on
  every re-render. Other `<details>` (footnotes, image descriptions) are left
  alone. Pass `openKnowls: false` (`--no-open-knowls` on the CLI) for the
  collapsed reading experience of a real `pretext build`.

### Images and other assets

Every image the page shows is an ordinary link under one of two fixed
prefixes, exactly as in a real build. Author-supplied files are under
`external/`, and everything `pretext generate` makes (latex-image, PreFigure,
sageplot, asymptote, …) is under `generated/`:

```html
<img src="external/kitten.png" />
<img src="generated/latex-image/diagram.svg" />
```

A real build copies both directories next to its pages. A preview has no such
directory, so the host maps each URL to wherever it keeps the file:

```js
import { renderHtml } from "@pretextbook/pretext-html";
import {
  rewriteAssetUrls,
  missingAssetPlaceholder,
} from "@pretextbook/pretext-html/assets"; // dependency-free subpath

const { html, assetDirs } = await renderHtml({ sourcePath: "source/main.ptx" });

const page = rewriteAssetUrls(html, (kind, relPath) => {
  // kind is "external" or "generated"; relPath is e.g. "latex-image/diagram.svg"
  const url = lookUp(kind, relPath); // a webview URI, a blob URL, a hosted URL…
  return url ?? missingAssetPlaceholder(kind, relPath);
});
```

- `assetDirs` gives the absolute directories behind the two prefixes, resolved
  the way PreTeXt resolves them. `external` comes from the document's
  `<docinfo><directories external="…"/>`, falling back to the publication
  file's deprecated `source/directories/@external`; it is absent when neither
  declares one, which PreTeXt reads as "no external assets". `generated` comes
  from the publication file's `source/directories/@generated` and defaults to
  `generated/` beside the main source file.
- A host without a filesystem (a browser editor) ignores `assetDirs` and
  answers from its own store of uploaded or generated files. Nothing reads
  image files during the render itself.
- Give a file a new URL when it changes, for instance with a version or
  modification-time query. A page never fetches an `<img>` again while its
  `src` is unchanged, and a live patch leaves an unchanged element alone, so a
  regenerated image behind the same URL keeps showing the old picture. With a
  new URL, a live patch updates just that `src` in place and only that image
  reloads. Re-deliver the page when the files change (the VS Code preview
  watches the asset directories), not only when the source does.
- `missingAssetPlaceholder` returns a data-URI SVG that names the missing file
  and says what to do (`pretext generate latex-image`, or "check @source"),
  which reads better than the browser's broken-image glyph. Return `undefined`
  from the resolver instead to leave a URL as it is.
- Only `src` attributes are rewritten. An annotated PreFigure diagram (one with
  `<annotations>`) is drawn by a script from `data-src`/`data-cml` attributes,
  which are left alone.
- The CLI applies this itself when it writes a file (`--output`), linking each
  asset relative to the output file. HTML written to stdout keeps PreTeXt's
  own URLs.

### Previewing one division of a large document

A render costs what PreTeXt's assembly costs, and that tracks the number of
elements in the document: a few hundred milliseconds for a chapter, tens of
seconds for a whole book. A live preview of a large document therefore should
not render the whole document, and need not: the `subtree` option renders one
division of it, numbered and cross-referenced exactly as the whole document
would number it, by pruning the rest to a skeleton (see `src/skeleton.ts`).

```js
const { html, size, subtree } = await renderHtml({
  sourcePath: "source/main.ptx",
  subtree: {
    line: cursorLine, // the division around the author's cursor...
    file: cursorFile, // ...in this file (defaults to sourcePath)
    level: 2, // chunk level: sections of a book are pages of their own
    wholeDocumentUpTo: 3000, // but a small document previews whole
  },
});
```

- `line`/`file` select the innermost division containing a source line; `id`
  selects by `xml:id` instead (an element inside a division selects that
  division). The division need not carry an `xml:id` of its own — the one
  PreTeXt would stamp on it is injected, so the page's HTML ids are unchanged.
- A division that contains divisions is previewed as a **summary page**: its
  own content (introduction, conclusion, loose paragraphs) rendered in place,
  then links to the divisions inside it, as the chapter page of a chunked
  build summarizes its sections. Only leaf divisions render in full, so a
  cursor at the top of a book shows the book's front matter and a table of
  its chapters, never the book. The summary links are inert on a one-page
  preview but carry `data-ptx-division` (and `data-ptx-id` for a link to an
  element), so a host can make them re-render with `subtree: { id }`.
- `level` has PreTeXt's chunk-level meaning, for a host that wants whole
  pages at some depth: the preview is the page that would hold the selection
  in a build chunked at that level. A selection deeper than `level` previews
  its ancestor at `level`, whole; one at `level` is shown whole; one shallower
  is the summary page above. Omit it to treat every division as a page of its
  own.
- `wholeDocumentUpTo` renders the whole document instead when it has no more
  than that many elements — a small document previews whole as fast as any
  division of it would.
- Every result carries `size` (`elements`, `bytes`, and the `files` the
  document spans, to watch for changes), and `subtree` (`id`, `level`,
  `collapsed`) when one division was emitted rather than the whole document.
  `measureDocument(options)` reports the same `size` without rendering, for a
  host deciding how much to preview before each render.
- With `fragment: true` and a context document, `subtree` narrows the preview
  within the placed fragment — a cursor line in a chapter file previews the
  section it is in.

What a division preview still has to do on every render is read and parse the
whole document, to prune it. Two options keep that cheap:

- `readSource(path)` (or `files`, a map from absolute path to content) supplies
  the document's files from memory — the xi:include targets, the context
  document, the publication file — for a host that already holds its project
  in memory (a browser editor) or has unsaved buffers (an editor). A reader
  that returns `undefined` for a path falls through to the platform's own read.
- A per-file parse cache, on by default, reuses the parse of every file whose
  content has not changed since the last render. It is keyed by file, not by
  the assembled document, so it does not matter how the project is split into
  files: a keystroke re-parses the file being edited and nothing else. Pass a
  `SourceCache` of your own as `cache` to scope it (and `invalidate()` it), or
  `cache: false` to parse afresh each time.

On a synthetic 12-chapter book of 28,000 elements split into 157 files, a
section or subsection preview takes well under a second warm (0.3–0.8s
measured, most of it the division itself), and a chapter's summary page about
the same, against 20–40 seconds for the whole book.

### API (browser)

The same renderer runs in a browser — no server, no Python. Bundlers pick it up
through the `browser` export condition automatically; there is nothing to
configure.

```js
import { renderHtml, isJspiAvailable } from "@pretextbook/pretext-html";

if (!isJspiAvailable()) {
  // No WebAssembly JSPI in this engine — fall back to a server-side build.
}

const { html } = await renderHtml({
  sourcePath: "/source/main.ptx", // a *virtual* path: no filesystem is read
  sourceContent: editorText, // required in the browser
  projectDir: "/source",
  fragment: true, // rendering one division on its own
});
```

Differences from the Node API, all of them consequences of there being no
filesystem:

- **`sourceContent` is required.** `sourcePath` still anchors relative
  `xi:include`s and the output's URLs, but nothing is read from it.
- **`xi:include`s are not resolved from disk.** Supply the project's files
  through `readSource` or `files` (see above) and they are resolved from
  there, with the per-file parse cache working as it does under Node; or
  pre-merge them and pass the merged document as `sourceContent`. An
  unresolvable include uses its `<xi:fallback>` if it has one, and otherwise
  throws.
- **`publicationPath` / `docinfoSourcePath` need absolute URLs**, since those
  are the only readable locations. Prefer `docinfo` (a string) over
  `docinfoSourcePath`.
- **Stylesheets are fetched from jsDelivr**, version-pinned to the installed
  package, so no build configuration is needed. To self-host them, copy this
  package's `assets/` directory somewhere your app serves and call
  `setAssetsBase("/pretext-assets")` before the first render. (Under Node the
  equivalent is `PRETEXT_HTML_ASSETS`, or the same `setAssetsBase`.)
- **A cold render costs two requests**, not ~32: `assets/xsl-bundle.json` packs
  the whole stylesheet closure (13 stylesheets plus the 17 locale files
  `pretext-common.xsl` eagerly loads) into one file. It is purely an
  optimisation — if it is missing, each file is fetched individually and the
  render still succeeds. It is recorded from a real render by
  `npm run build-xsl-bundle`, which runs as part of `npm run build`.

Typical timings, measured on a single-division fragment: **~400ms cold**
(stylesheet compile plus asset fetch, paid once per session and then cached)
and **~90ms warm**. That is what makes preview-on-save feel instant.

`setMountReader()` is the escape hatch if neither delivery mode fits — it lets
you serve the stylesheets from an in-memory map, a zip, or a webview resource
URI.

### Theme control

A rendered page can already switch between light and dark — pretext-core.js
exposes `window.setDarkMode(isDark)` — but on its own it only decides which to
use from `localStorage` and `prefers-color-scheme`. Neither reflects an
embedder's surroundings ("VS Code is in a dark editor theme", "pretext.plus is
in dark mode"). The `theme` render option lets the app drive it instead:

```js
import { renderHtml } from "@pretextbook/pretext-html";
// dependency-free subpath — no WASM renderer pulled in:
import { previewThemeMessage } from "@pretextbook/pretext-html/theme";

const { html } = await renderHtml({
  sourcePath: "source/main.ptx",
  theme: "dark", // initial theme baked in (no light-then-dark flash)
});

// Later, when the host theme changes, post an update — no re-render needed:
iframe.contentWindow.postMessage(previewThemeMessage("light"), "*");
// (VS Code webview: webview.postMessage(previewThemeMessage("light")))
// (inline render:  window.postMessage(previewThemeMessage("light"), "*"))
```

When `theme` is set, the renderer injects a small script into the page `<head>`
that (1) applies the initial theme and (2) listens for
`postMessage({ type: "pretext-html:set-theme", theme })` from the embedder and
re-applies live. `"system"` follows `prefers-color-scheme`. Omit `theme`
entirely and the output is byte-identical to a plain render — the page keeps
its native `localStorage`/`prefers-color-scheme` behaviour. The
`@pretextbook/pretext-html/theme` subpath exports the protocol
(`PreviewTheme`, `PREVIEW_THEME_MESSAGE`, `previewThemeMessage`,
`isPreviewTheme`) with no dependency on the renderer, so a host can import just
the message helper.

### Slideshows (reveal.js)

A document whose top-level element is `<slideshow>` is rendered as a
[reveal.js](https://revealjs.com) deck instead, through PreTeXt's own
`pretext-revealjs.xsl`. Detection is automatic — there is nothing to turn on —
and `RenderResult.target` reports which conversion ran.

```js
import { renderHtml } from "@pretextbook/pretext-html";
// dependency-free subpath, like ./theme:
import { injectRevealBridge } from "@pretextbook/pretext-html/reveal";

const { html, target } = await renderHtml({
  sourcePath: "source/slides.ptx",
  revealView: "scroll", // the default: whole deck as one scrolling page
  revealTheme: "black", // fallback only; the project's own theme wins
  revealZoom: 1, // content size vs. presented size (scroll view)
});
target; // "slides"

// Switch to the ordinary presentation later — no re-render, just re-inject:
const presenting = injectRevealBridge(html, "slides");
```

Two things are forced on a slideshow render, overriding the publication file,
because the alternatives cannot work without the Python toolchain:
`revealjs/resources/@host` becomes `cdn` (a `local` host points at a `dist/`
tree that was never copied anywhere; `embedded` expects a post-processing step
that never runs), and `@math` becomes `online` (embedded mathematics is
prebuilt SVG passed in through the `mathfile` parameter, and without it a deck
renders with its mathematics silently missing). Everything else — theme,
navigation mode, controls — stays as the project authored it.

The scroll view is tuned for reading a deck rather than presenting it. It lays
slides out at reveal's nominal **960×700** and scales them to fit, stacks them
with `scrollLayout: "compact"` and an outline around each, and shows every
`@pause`/`<subslide>` fragment at once so scrolling is not interrupted. Switch
to `revealView: "slides"` to see the pauses step through as they will when
presented.

Showing the pauses at once takes more than `fragments: false`, which is worth
knowing if you ever touch this: the scroll view counts its scroll steps with
`querySelectorAll('.fragment')` and never consults that setting, so the config
alone makes fragments _visible_ while reveal still adds a scroll step — and a
full `scrollTriggerHeight` of padding — for each one. Compact layout compounds
it, because a page with any scroll trigger reverts to a full-viewport height.
A slide with two pauses ends up roughly three screens tall. The injected script
therefore removes the `fragment` class outright before `initialize` runs.

The nominal size is worth understanding, because it is the one override that
changes how a deck _looks_: PreTeXt publishes `width: "100%", height: "100%"`,
and reveal resolves a percentage against the presentation element — so the
slide becomes exactly as large as whatever is showing it, the computed scale is
always 1, and no downscaling ever happens. Full screen that is fine; in an
editor pane it means text sized for a 960px slide is drawn at full size into a
fraction of that width. Giving reveal a real deck size to scale from restores
the proportions a full-screen presentation will have.

`revealZoom` then works _in slide units_, dividing that nominal size rather than
shrinking the slide on screen — `0.5` gives a 1920×1400 slide. This is the only
arrangement that behaves like zooming out on a web page. Reveal lays content out
in slide units and scales the whole slide to fit, so a smaller _box_ fits
exactly the same content and clips exactly the same overflow; a larger box
leaves the slide the same size on screen (reveal simply scales it down further)
while fixed-pixel text occupies proportionally less of it. Since reveal clips
whatever runs past the bottom of a slide, with no way to scroll to it, zooming
out is the only way to read content that does not fit — which is also why the
default is `1`, where the deck, overflow included, looks exactly as it will when
presented.

Two further notes:

- **`RenderOptions.theme` does nothing for a deck.** reveal.js pages load none
  of the PreTeXt javascript behind light/dark mode, so there is no
  `setDarkMode` to drive. Pick a light or dark **reveal** theme with
  `revealTheme` instead.
- **Views are baked in at render time.** reveal reads `view` once, when it
  initializes, so `injectRevealBridge` returns a new page rather than talking
  to a live deck — deliver it as a fresh document (`webview.html = …`, not an
  in-place rewrite) for the change to take.

### Print preview (worksheets and handouts)

A worksheet or handout is written to be printed, and PreTeXt lays one out very
differently on paper than on screen: paginated to a paper size, headers and
footers per sheet, solutions dropped, and every `<workspace>` grown to the
height the author asked for — which is the only way to see how much room a
student really gets. A built page reaches that layout through a URL query
parameter (`?printpreview=<id>`), which an in-memory preview has nowhere to put.

```js
import { renderHtml } from "@pretextbook/pretext-html";
// dependency-free subpath, like ./theme and ./reveal:
import { injectPrintPreview } from "@pretextbook/pretext-html/printout";

const { html, printouts, rootPrintout } = await renderHtml({
  sourcePath: "source/worksheet-3.ptx",
  fragment: true,
});

printouts; // [{ id: "ws-3", type: "Worksheet", number: "3",
//              title: "Counting", label: "Worksheet 3: Counting" }]
rootPrintout; // "ws-3" — this document *is* a printout, so open it on paper

// Enter (or leave) the layout later — no re-render, just re-inject:
const onPaper = injectPrintPreview(html, "ws-3");
const onScreen = injectPrintPreview(html); // back to the ordinary page
```

`printouts` lists what the page offers, ready for a menu; `rootPrintout` is set
only when the rendered document is a printout rather than merely containing
some, which is the case worth defaulting to. Passing `printPreview: "<id>"` to
`renderHtml` bakes the layout in at render time instead.

Three things to know if you embed this:

- **State the layout on every delivery, off included.** The injected bridge
  keeps its answer on a window property, and a host that rewrites its document
  in place (`document.open`/`write`/`close`) keeps the same `Window` — so a page
  delivered without a bridge inherits whatever the previous one said. Call
  `injectPrintPreview` on the way to the panel, every time.
- **An unknown id is treated as "off".** pretext-core.js swaps in the print
  stylesheet _before_ it looks the element up, so a stale id would strand the
  reader on a print-styled page with nothing on it.
- **The transformation is one-way.** It runs once, from a DOMContentLoaded
  handler, and rearranges the DOM destructively; leaving print preview means
  re-delivering the pristine HTML, not undoing anything.
- **The print layout is always light**, whatever theme you asked for. Paper is,
  and `print-worksheet.css` carries no dark palette — only a few incidental
  `.dark-mode` rules — so the injection removes the `dark-mode` class and sets
  `data-darkmode="disabled"`, which both pretext-core.js and the theme bridge
  honour (a later `previewThemeMessage` cannot undo it). It also states the page
  background explicitly: the print stylesheet paints none, expecting the theme
  it replaced to have done it, so an embedded page would otherwise show its
  host's backdrop through black print text. The ordinary page is untouched and
  keeps its theme.

The print stylesheet is fetched from the CDN when the layout is entered, and
pretext-core.js waits for its `load` event before continuing — so with no
network the page stops part-way, unstyled. That is upstream's flow, unchanged
here.

## Requirements

- **Node ≥ 24** launched with **`--experimental-wasm-jspi`** (WebAssembly
  stack switching). Node 22 does **not** work despite accepting the flag: its
  V8 (12.4) has only the older Suspender-era JSPI and never exposes the
  `WebAssembly.Suspending` API this package needs. The flag is not allowed in
  `NODE_OPTIONS`; it must be on the command line. The `pretext-html` CLI re-executes itself with the flag;
  API users must supply it themselves (in tests, vitest's `execArgv` option
  works — see `vite.config.mts`).
- Runtimes with V8 ≥ 13.7 (Chromium/Electron ≥ 137, and eventually Node
  itself) ship JSPI **enabled by default and reject the flag** as a bad
  option. Feature-detect with `"Suspending" in WebAssembly` (exported as
  `isJspiAvailable()`) before adding the flag rather than assuming it is
  needed.
- Network access _for the rendered page_ (theme css/js, MathJax and Runestone
  Services come from `cdn.jsdelivr.net`). The transform itself runs fully
  offline.

## How it works

1. **Vendored stylesheets** — `assets/xsl/` is a snapshot of the upstream
   [`pretext/xsl`](https://github.com/PreTeXtBook/pretext/tree/master/xsl)
   tree (GPL-licensed; see `assets/xsl/LICENSE-pretext`). Refresh with
   `npm run refresh:xsl` from the monorepo root.
2. **Generated wrapper** — `assets/preview-html.xsl` imports `pretext-html.xsl`
   and overrides the `file-wrap` template with a verbatim copy minus its
   `<exsl:document>` wrapper, so the complete page (head, theme links,
   masthead, content) lands on the main result tree instead of on disk. All
   other file-writing templates are stubbed. The wrapper is **generated** by
   `scripts/refresh-xsl.mjs`, which also audits every `exsl:document` site
   reachable from `pretext-html.xsl` and fails if upstream adds a writer we
   don't cover. `assets/preview-revealjs.xsl` is the slideshow counterpart and
   is far thinner: `pretext-revealjs.xsl` already emits one monolithic page, so
   there is no template to copy — it only stubs the same file writers (a slide
   holding an `<interactive>` really does reach one) and stamps `@id` onto
   slides, via `apply-imports` so no upstream markup is duplicated.
3. **Virtual-host fetch shim** — the WASM build has no filesystem
   (`FILESYSTEM=0`); every resource load (stylesheet imports, `document()`
   calls, the publication file) goes through the global `fetch`. We mount
   fake origins like `http://mnt1.ptx.invalid` backed by local directories
   and in-memory strings — no HTTP server involved.
4. **JS XInclude** — `xi:include` is resolved in JavaScript before parsing
   (libxml2's own XInclude pass cannot suspend in the current WASM build).
   Supports nested includes, `parse="text"`, and `xi:fallback`; `xpointer` is
   not supported.
5. **Platform seam** — `src/host.ts` holds everything that touches the outside
   world: read a file under a mount, read a caller-named file, locate
   `assets/`. Under Node those are filesystem calls; in the browser build
   (`src/host.browser.ts`, swapped in by `vite.config.mts`) they are `fetch`es.
   The browser build also substitutes a posix-only `node:path`
   (`src/internal/posix-path.ts`), which is sound because no path this package
   computes ever reaches a real filesystem — with `FILESYSTEM=0` they are all
   virtual, ending up as mount keys or `.ptx.invalid` URL segments. The result
   has no `node:` imports at all; rollup fails the build if one survives.
6. **Pinned CDN assets + Runestone Services** — `src/html-static.ts` is
   generated by `scripts/refresh-runestone.mjs` and names one
   [`html-static`](https://github.com/PreTeXtBook/html-static) release, which
   every render passes as `cli.version`. That release is where PreTeXt's css/js
   come from, and also where the Runestone Services bundle lives, whose
   filenames are captured from the same release's
   `dist/_static/webpack_static_imports.xml` and passed as `rs-js` / `rs-css` /
   `rs-version`. Refresh with `npm run refresh-runestone` (a full
   `npm run refresh:xsl` does it too).

### Runestone interactive exercises

Multiple choice, Parsons problems, fill-in-the-blank, ActiveCode and the rest
are rendered by the stylesheets as inert markup — `<div
data-component="parsons">` and friends — that only becomes an exercise once
Runestone's JavaScript runs. Upstream links that JavaScript from the `rs-js` /
`rs-css` string parameters, which the Python CLI supplies and this renderer now
supplies too, so the exercises work in a preview.

This is unrelated to `<platform runestone="yes">`, which selects hosting on a
Runestone _server_ (accounts, stored grades, `$b-host-runestone`). Previews are
always ordinary web builds — `eBookConfig.useRunestoneServices = false` — and
the components run client-side, exactly as in a `platform="web"` build.

Because the bundle filenames are content-hashed, they are only valid for the
`html-static` release they were captured from; that is why `cli.version` is
pinned rather than left at upstream's `latest`. Pass an empty `rs-js`/`rs-css`
through `stringParams` to link no Runestone code at all.

## Limitations (current WASM build)

| Limitation                                     | Cause                                                | Fix                                                                         |
| ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| No multi-file output (`exsl:document`)         | Compiled with `FILESYSTEM=0`                         | Rebuild with `FILESYSTEM=1` (files land in MEMFS)                           |
| JSPI required (flagged on Node)                | Loader fetches resources mid-transform via JSPI      | Feature-detect with `isJspiAvailable()`; engines without it need a fallback |
| No generated images (latex-image, sageplot, …) | Produced by the Python toolchain, not XSLT           | Out of scope; run `pretext generate` and the page links the files it made   |
| `xi:include` with `xpointer` unsupported       | JS resolver stands in for libxml2's                  | Rebuild adding `xmlXIncludeProcessFlags` to the JSPI export list            |
| Renders run one at a time, never in parallel   | Shared libxslt state; the transform suspends mid-run | Inherent; `renderHtml` queues concurrent calls for you                      |

The whole-book stack overflow ("memory access out of bounds") that the stock
`libxslt-wasm` build hit on large documents is **fixed** in the
`@pretextbook/libxslt-wasm` fork, which links with a larger WASM stack.

### Concurrency

A render is not reentrant. It drives a single cached compiled stylesheet
through a patched `globalThis.fetch` and shared mount tables, and it _suspends_
mid-transform to fetch stylesheets — which is precisely the window in which
another render would get to run. Overlapping renders interleave inside libxslt
and corrupt it.

`renderHtml` therefore **queues**: concurrent calls are safe, and each resolves
with its own result, but they execute one at a time rather than in parallel. A
render that rejects does not stall the queue.

This matters mainly if you drive the internals yourself. If you do, serialize
your own calls — the corruption is not self-describing: it surfaces as an
out-of-bounds memory fault, and afterwards the WASM instance aborts on _every_
later call for the lifetime of the process. Once that has happened, only a
restart (or a page reload) recovers; `renderHtml` detects the state and says so
rather than repeating the underlying assertion.

Missing generated assets cost the render nothing: the page links every image
whether or not the file exists, and deciding what to show for a missing one is
the host's (see [Images and other assets](#images-and-other-assets)).

## Forking libxslt-wasm

This package depends on [`@pretextbook/libxslt-wasm`](https://github.com/oscarlevin/libxslt-wasm),
a fork of [jeremy-code/libxslt-wasm](https://github.com/jeremy-code/libxslt-wasm)
(MIT) rebuilt with different Emscripten link flags. The remaining limitations
above are also flag changes, not architecture — when ready to tackle them:

- `-sSTACK_SIZE` (already raised in the fork) — fixes whole-book stack
  overflows; pair with `-sALLOW_MEMORY_GROWTH=1`.
- `-sFILESYSTEM=1` — enables `exsl:document` writes into in-memory MEMFS,
  readable back from JS; unlocks real multi-file builds.
- Add `xmlXIncludeProcessFlags` to the JSPI exports list (the `Asyncify`/JSPI
  `exportPattern` — see `ASYNCIFY_EXPORTS` in the build) so native XInclude can
  suspend for fetches; then the JS resolver in `src/xinclude.ts` can be retired.
- To drop the JSPI requirement entirely (needed for Firefox/Safari/browser
  use): preload `assets/xsl/` into MEMFS at module init so no fetch happens
  mid-transform, and switch the entity loader to synchronous MEMFS reads.

**Refreshing the fork:** rebuild the WASM in the fork, `npm version` + `npm
publish` it, then bump the `@pretextbook/libxslt-wasm` version in this
package's `package.json`. Everything else — wrapper stylesheet, mounts, API —
stays the same.

## Development

```sh
npm run build -w @pretextbook/pretext-html    # vite build to dist/
npm run test -w @pretextbook/pretext-html     # vitest (JSPI via execArgv)
npm run refresh:xsl                            # re-vendor xsl + regenerate wrapper (from repo root)
```
