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

The output is a single, standalone HTML page: PreTeXt's _portable HTML_ mode
is forced on, so theme css/js and MathJax load from public CDNs and the whole
document is rendered as one page. This is what powers the "Instant Preview"
in the PreTeXt-tools VS Code extension, and it is published so other tools
(e.g. pretext.plus) can render previews the same way.

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
- The user's publication file is respected, except
  `<html><platform portable="yes"/></html>` is always forced — that is what
  makes single-page in-memory output possible.
- The compiled stylesheet is cached per `xslDir` (~1s to compile, then
  ~100ms–1s per render depending on document size).
- `theme: "dark" | "light" | "system"` makes the preview follow the embedding
  app's light/dark theme (see [Theme control](#theme-control)).

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
- **`xi:include`s are not resolved from disk.** Pre-merge them, or pass the
  already-merged document as `sourceContent`. An unresolvable include uses its
  `<xi:fallback>` if it has one, and otherwise throws.
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
- Network access _for the rendered page_ (theme css/js and MathJax come from
  `cdn.jsdelivr.net`). The transform itself runs fully offline.

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
   don't cover.
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

## Limitations (current WASM build)

| Limitation                                     | Cause                                           | Fix                                                                         |
| ---------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| No multi-file output (`exsl:document`)         | Compiled with `FILESYSTEM=0`                    | Rebuild with `FILESYSTEM=1` (files land in MEMFS)                           |
| JSPI required (flagged on Node)                | Loader fetches resources mid-transform via JSPI | Feature-detect with `isJspiAvailable()`; engines without it need a fallback |
| No generated images (latex-image, sageplot, …) | Produced by the Python toolchain, not XSLT      | Out of scope; run `pretext generate` and the preview will pick the files up |
| `xi:include` with `xpointer` unsupported       | JS resolver stands in for libxml2's             | Rebuild adding `xmlXIncludeProcessFlags` to the JSPI export list            |
| Renders run one at a time, never in parallel   | Shared libxslt state; the transform suspends mid-run | Inherent; `renderHtml` queues concurrent calls for you                 |

The whole-book stack overflow ("memory access out of bounds") that the stock
`libxslt-wasm` build hit on large documents is **fixed** in the
`@pretextbook/libxslt-wasm` fork, which links with a larger WASM stack.

### Concurrency

A render is not reentrant. It drives a single cached compiled stylesheet
through a patched `globalThis.fetch` and shared mount tables, and it *suspends*
mid-transform to fetch stylesheets — which is precisely the window in which
another render would get to run. Overlapping renders interleave inside libxslt
and corrupt it.

`renderHtml` therefore **queues**: concurrent calls are safe, and each resolves
with its own result, but they execute one at a time rather than in parallel. A
render that rejects does not stall the queue.

This matters mainly if you drive the internals yourself. If you do, serialize
your own calls — the corruption is not self-describing: it surfaces as an
out-of-bounds memory fault, and afterwards the WASM instance aborts on *every*
later call for the lifetime of the process. Once that has happened, only a
restart (or a page reload) recovers; `renderHtml` detects the state and says so
rather than repeating the underlying assertion.

Missing generated assets degrade gracefully: the transform serves a stub for
missing files, PreTeXt emits its usual `PTX:ERROR` advice, and the preview
renders without the image.

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
