---
"@pretextbook/pretext-html": minor
---

Interactives authored with `@platform` (GeoGebra, JSXGraph, D3, Sage, DoenetML, JavaScript), and `<interactive geogebra="…">`, no longer render as an empty frame. Their iframe pages, which a PreTeXt build writes to `<id>-if.html` files, are now returned as `RenderResult.iframePages`; `embedIframePages` (also on the new `./iframe-pages` subpath) inlines them as `srcdoc`, optionally sandboxed. The CLI inlines them itself.
