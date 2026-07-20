---
"@pretextbook/pretext-html": minor
---

Add a browser build, so PreTeXt can be rendered to HTML client-side with no
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
