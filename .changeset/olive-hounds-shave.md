---
"pretext-tools": patch
"@pretextbook/pretext-html": patch
---

Fix live preview failing with a "Node.js 22 or later" error even when Node 22 is installed (seen in Codespaces and other remote windows).

Two problems: the worker only ever probed `node` from PATH with a single flag spelling, and the stated requirement was wrong. Node 22 cannot run the renderer at all — its V8 (12.4) accepts `--experimental-wasm-jspi` but only implements the older Suspender-era JSPI, so it never exposes the `WebAssembly.Suspending` API the XSLT engine needs. The real floor is Node 24.

The worker now also tries the runtime already hosting the extension (VS Code Server's bundled Node, or Electron via `ELECTRON_RUN_AS_NODE`) and the older `--experimental-wasm-stack-switching` flag spelling. Since VS Code ships a recent Node, the preview now works with no separate Node installation and no `instantPreview.nodePath` setting. Every probe attempt is logged to the PreTeXt output channel, and the documented requirement is corrected to Node 24+.
