# PreTeXt Tools on the Web (github.dev / vscode.dev) — Plan

Goal: let authors without a local install or a Codespace use PreTeXt Tools in
the browser-only VS Code hosts (github.dev, vscode.dev, and the web view of a
GitHub repo via `.`). Everything that needs the `pretext` CLI stays
desktop/Codespaces-only; everything that is pure TypeScript — highlighting,
snippets, typing shortcuts, completions, schema validation, formatting, the
visual editor — should work in the browser.

Decisions already made:

- **One extension, two entry points.** Not a second marketplace listing. The
  manifest gains a `"browser"` entry beside `"main"`; VS Code loads whichever
  matches the host. One version number, one changelog, one install.
- **The language server moves into a Web Worker on the web host**, using the
  same `lsp-server/` source. The server stops touching the filesystem
  directly; the client feeds it what it needs (see §4).
- **CLI-only commands are hidden on the web** via `when: "!isWeb"` rather than
  stubbed with "not available here" messages, so the web UI is simply smaller
  instead of full of dead buttons.
- Phased so each step ships on its own.

---

## 1. Primer: how web extensions work

A web extension runs in a **browser Web Worker**, not Node. The rules
([docs](https://code.visualstudio.com/api/extension-guides/web-extensions)):

| Thing                     | Web host                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry point               | `"browser": "./out/extension.web.js"` in `package.json`. A manifest with only `"main"` is **rejected outright** by github.dev — not even grammars load. |
| Module format             | CommonJS-shaped bundle; esbuild with `platform: "browser", format: "cjs"`, `vscode` external.                                                           |
| Node built-ins            | None. No `fs`, `path`, `child_process`, `__dirname`, `process.cwd()`. Bundlers can polyfill `path`; nothing can polyfill `fs`/`child_process`.          |
| Filesystem                | `vscode.workspace.fs` only (async, URI-based). `uri.fsPath` is meaningless.                                                                             |
| URI schemes               | Files are `vscode-vfs://github/<owner>/<repo>/…`, not `file:`. Any `scheme: "file"` filter silently excludes everything.                                |
| Extension assets          | `context.extensionUri` is an `https:` URL; `vscode.workspace.fs.readFile(Uri.joinPath(extensionUri, …))` works for shipped assets.                      |
| Language servers          | `vscode-languageclient/browser` + `vscode-languageserver/browser`, server launched with `new Worker(…)`, messages over `postMessage`.                   |
| Webviews                  | Work as on desktop (`webview.asWebviewUri` resolves to `https:`).                                                                                       |
| Declarative contributions | Grammars, snippets, language configuration, themes, walkthroughs, menus, views all work unchanged.                                                      |
| Context keys              | Built-in `isWeb` is `true` on web hosts; use it in `when` clauses.                                                                                      |
| `capabilities`            | Declare `virtualWorkspaces` and `untrustedWorkspaces` support honestly; VS Code labels the extension accordingly.                                       |
| Testing                   | `@vscode/test-web` runs vscode.dev locally in Playwright Chromium with the extension loaded from disk.                                                  |

---

## 2. Audit

### Why it does not work today

- [package.json](../packages/vscode-extension/package.json) has `"main"` but
  no `"browser"`. github.dev refuses to install the extension at all.
- The LSP server is forked as a Node process over IPC
  ([lsp-client/main.ts](../packages/vscode-extension/src/lsp-client/main.ts)).
- The client's `documentSelector` is `scheme: "file"` only.
- The host-side `extension.ts` imports everything eagerly, including the CLI
  wrappers (`cli.ts`, `commands/build.ts`, `livePreview.ts`, …), which import
  `child_process` at module scope. One Node import anywhere in the graph
  breaks the whole browser bundle.

### What is already browser-safe

- `@pretextbook/completions` (raw TS, dep: `vscode-languageserver-types`),
  `@pretextbook/format` (`xast-util-from-xml` + `unified`),
  `@pretextbook/typing-shortcuts`, `@pretextbook/latex-style-pretext`,
  `@pretextbook/markdown-style-pretext`, `@pretextbook/import`,
  `@pretextbook/latex-pretext`, `@pretextbook/remark-pretext`. `pretext-plus`
  already runs `completions`, `format` and `pretext-html` in a browser.
- `@pretextbook/schema` has an explicit platform seam
  ([platform.ts](../packages/schema/src/platform.ts) /
  `platform.browser.ts`) and a `"browser"` export condition; `salve-annos`,
  `saxes`, `xregexp` are pure JS.
- `vscode-languageclient` / `vscode-languageserver` 9.x ship `/browser`
  entries.
- Host modules with **no** Node imports: `typing-shortcuts.ts`,
  `snippet-suggestions.ts`, `actionsView.ts`, `visualEditor.ts` (except
  `getNonce` from `utils.ts`), `paste-convert*.ts`, `commands/convert.ts`,
  `outline-parser.ts`, `project-manifest.ts` (only `path.join` for display
  strings).

### Host modules that need porting (`fs`/`path` → `workspace.fs`/`Uri`)

| Module               | Node use                                                 | Web fix                                                                |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `flavor-takeover.ts` | `fs.existsSync(folder/project.ptx)`; `scheme === "file"` | `workspace.fs.stat`; allow `vscode-vfs`                                |
| `documentOutline.ts` | reads included files for project scope                   | `workspace.fs.readFile`                                                |
| `project-outline.ts` | `path` for resolving `xi:include` hrefs                  | `Uri.joinPath` / `vscode-uri` Utils                                    |
| `project.ts`         | walks workspace folders with `fs`, imports `cli`         | split: manifest discovery via `workspace.fs`; CLI-dependent parts stay |
| `targetsView.ts`     | `path` for labels                                        | `Utils.basename`                                                       |
| `ui.ts`              | imports `utils` → `child_process`                        | split output channel / status bar into `ui-core.ts`                    |
| `utils.ts`           | `execSync`, `fs`                                         | leave as desktop-only; move `getNonce` to `nonce.ts`                   |

### Host modules that stay desktop-only (CLI / process / local FS)

`cli.ts`, `cliPreviewServer.ts`, `commands/{build,view,new,deploy,update,
installSage,runPtx,select}.ts`, `livePreview.ts`, `instantPreview.ts` (forks
a worker process), `pandoc.ts`, `importWizardPanel.ts` (writes project files
with `fs`), `insert-import.ts`, `utils.ts` (spell check / schema config /
status bar menu).

### LSP server: the real work

| Where                                                                                                              | Node use                                                           | Web fix                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [paths.ts](../packages/vscode-extension/src/lsp-server/paths.ts)                                                   | `schemaDir = path.join(__dirname, "..", "assets", "schema")`       | asset base comes from the client via `initializationOptions.assetsUri`            |
| [schema.ts](../packages/vscode-extension/src/lsp-server/schema.ts)                                                 | `fs.readFileSync(rng)`, `fs.existsSync(customPath)`                | load through an injected async `readAsset(name)`; custom schema path desktop-only |
| [validation.ts](../packages/vscode-extension/src/lsp-server/validation.ts)                                         | reads precompiled grammar JSON; reads `xi:include`d files          | `readAsset`; project files from the in-memory snapshot                            |
| [completions/utils.ts](../packages/vscode-extension/src/lsp-server/completions/utils.ts)                           | `getReferences()` walks the project with `fs`, `realpathSync(".")` | read from the in-memory snapshot                                                  |
| [projectPtx/find-root-documents.ts](../packages/vscode-extension/src/lsp-server/projectPtx/find-root-documents.ts) | walks parent dirs reading `project.ptx` via `fsPath`               | snapshot lookup by URI                                                            |
| `get-xinclude-links.ts`, `completions/get-completions.ts`                                                          | `path` for resolving hrefs                                         | `vscode-uri` `Utils.resolvePath`                                                  |
| `connection.ts`                                                                                                    | `createConnection(ProposedFeatures.all)` from `/node`              | `/browser` reader/writer over `self`                                              |

---

## 3. Phases

### Phase 0 — installable on the web ✅ (this branch)

Deliverable: the extension installs in github.dev and provides everything
that does not need the language server.

- `package.json`: `"browser": "./out/extension.web.js"`;
  `capabilities.virtualWorkspaces = { supported: "limited" }`;
  `when: "!isWeb"` on every CLI-bound command in `commandPalette`, the
  Targets inline build/view buttons, and the Targets welcome text; a
  web-only welcome text in its place.
- `src/extension.web.ts`: a second `activate()` registering only browser-safe
  pieces — output channel, typing shortcuts, snippet suggestions, flavor
  takeover, visual editor, paste-and-convert, convert-text, actions view
  (filtered to web-available actions), document outline (file scope only
  until §Phase 2), getting-started, show-log.
- `src/nonce.ts`, `src/ui-core.ts`: split the Node-free bits out of
  `utils.ts` / `ui.ts` so the web graph never reaches `child_process`.
- `flavor-takeover.ts`: `workspace.fs.stat` instead of `fs.existsSync`;
  accept `vscode-vfs` URIs.
- `build.mjs`: fourth esbuild target `extension.web.js`
  (`platform: "browser"`, `format: "cjs"`).
- `@vscode/test-web` devDependency and `npm run open:web -w pretext-tools`
  for a local vscode.dev dev loop.

Findings while landing Phase 0:

- esbuild `platform: "browser"` picks packages' `browser` export condition,
  and `decode-named-character-reference` (via micromark, via remark) maps that
  to a DOM implementation that calls `document.createElement` at module scope
  — fatal in a worker. Both browser bundles build with
  `conditions: ["worker"]`, which the package maps to its DOM-free entry.
  Any future "`document` is not defined" on activation is the same class of
  problem: find the module with the bundle's `// node_modules/...` banners.
- `@pretextbook/import` carries `Buffer`/`process.nextTick` references in
  its lazily-loaded upload chunk. They are guarded and never run at
  activation; the smoke test would catch a regression.
- Format Document works on the web before Phase 1: `lsp-client/shared.ts`
  formats in-process with `@pretextbook/format` when no client is running,
  and the web entry registers a `DocumentFormattingEditProvider` so the
  built-in Format Document command works too.
- `npm run test:web -w pretext-tools` runs a four-test smoke suite
  (`src/test/web/`) inside the real Web Worker host via `@vscode/test-web`
  (headless Chromium): activation, language detection, command gating,
  formatting.

What a web user gets after Phase 0: syntax highlighting (PreTeXt, LaTeX and
Markdown flavors), snippets, language configuration, `$x$` → `<m>` and the
other typing shortcuts, snippet suggestions, LaTeX/Markdown paste conversion,
the visual editor, the walkthrough.

### Phase 1 — language server in a Web Worker

Deliverable: completions, schema diagnostics, formatting, document links,
code actions on the web.

1. **Project snapshot instead of `fs`.** New server-side module
   `lsp-server/project-files.ts`: an in-memory `Map<uri, text>` plus
   `resolve(fromUri, href)`. The client populates it:
   - on start: `workspace.findFiles("**/*.ptx")` → `pretext/projectFiles`
     notification with `{ uri, text }[]`;
   - on save / create / delete of `**/*.ptx` and `project.ptx`: incremental
     `pretext/projectFileChanged`.
   - Open documents are served from `documents` (already in memory).
     This replaces `fs` in `completions/utils.ts`, `validation.ts`,
     `find-root-documents.ts`. Same code path on desktop, so remote and virtual
     workspaces get fixed for free. Keep the sync shape of `getReferences()` —
     the map is already in memory.
2. **Assets instead of `__dirname`.** `initializationOptions.assetsUri`;
   server exposes `readAsset(name): Promise<string>` implemented with a
   `pretext/readAsset` request to the client (`workspace.fs.readFile`). RNG
   ASTs and the precompiled grammar are loaded once at init and cached.
   Custom schema path (`pretext-tools.schema.customPath`) is read by the
   client the same way, so it keeps working on desktop.
3. **`path` → `vscode-uri`.** `Utils.resolvePath`, `Utils.dirname`,
   `Utils.basename` in `get-xinclude-links.ts`, `get-completions.ts`,
   `project-outline`-style href resolution. `vscode-uri` is already a
   dependency.
4. **Transport.** `connection.ts` picks `/node` or `/browser` by build; the
   browser bundle is `out/lsp-server.web.js` (`platform: "browser"`,
   `format: "iife"`). New `lsp-client/browser.ts` creates the worker with
   `new Worker(Uri.joinPath(context.extensionUri, "out/lsp-server.web.js").toString())`.
   Shared `documentSelector` (language-only, no scheme filter) in
   `lsp-client/shared.ts`.
5. **`@pretextbook/schema` browser build** is picked up automatically by the
   `"browser"` export condition when esbuild runs with `platform: "browser"`.

Risks: `salve-annos` grammar JSON is a few MB — measure worker start time;
lazy-load the Experimental grammar. `xregexp` and `saxes` are fine.

### Phase 2 — read-only project views on the web

- `documentOutline.ts` / `project-outline.ts`: project scope through
  `workspace.fs.readFile` so the project-wide outline works.
- `project.ts`: manifest discovery via `workspace.findFiles("**/project.ptx")`
  - `workspace.fs.readFile`; the Targets view lists targets (reveal definition
    works; build/view buttons already hidden by `!isWeb`).
- `importWizardPanel.ts`: port file writes to `workspace.fs` so Import works
  in the browser (the conversion itself is pure).

### Phase 3 — instant preview on the web (optional)

`@pretextbook/pretext-html` runs in a browser (pretext-plus does it) but
requires WebAssembly JSPI — Chromium only today. Replace the forked
`instant-preview-worker.mjs` with a Web Worker, gate on
`WebAssembly.Suspending !== undefined` (mirror pretext-plus
`isLocalPreviewAvailable()`), and show the "needs Chromium" notice otherwise.
The preview already fetches its static assets from the CDN host, so nothing
local is needed beyond the WASM binary shipped in `out/`.

---

## 4. Design note: why a snapshot, not a file-read RPC

Two ways to give a worker-hosted server access to project files:

- **RPC per read**: server sends `pretext/readFile(uri)` whenever it would
  have called `fs.readFileSync`. Minimal server changes in principle, but
  every reader becomes async, and `getReferences()` / validation call these
  in loops — hundreds of round trips on a large book, and a sync→async ripple
  through `references`, `initializeDocument`, completion handlers.
- **Snapshot pushed by the client** (chosen): the client already has
  `findFiles` and file watchers; one notification at start, incremental
  updates after. The server keeps its synchronous shape. Memory cost is the
  text of the project's `.ptx` files, which the Node server was reading
  repeatedly anyway.

---

## 5. Testing

- Unit: existing vitest suites keep running against the Node build.
- `npm run open:web -w pretext-tools` opens vscode.dev in Chromium with the
  built extension for manual checks.
- CI: add a `vscode-extension-web` job that builds and runs
  `@vscode/test-web --headless` with a small smoke suite (activation, grammar
  present, a completion request once Phase 1 lands).
- `vsce package` validates the manifest; it warns when `browser` is set but
  the bundle references Node built-ins.

## 6. Open questions

- Should the Experimental (`pretext-dev.rng`) grammar ship in the web bundle
  or load lazily from the extension's `assets/`? (Default: lazy, both hosts.)
- Does the status-bar "PreTeXt" quick pick (in `utils.ts`) earn a web
  version, or is the Actions view enough? (Default: Actions view only.)
