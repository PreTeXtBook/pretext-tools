# @pretextbook/pretext-html

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
