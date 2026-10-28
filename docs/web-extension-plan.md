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

(All of these were ported in Phases 0–2; see the phase notes below for how.)

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

### Phase 1 — language server in a Web Worker ✅ (this branch)

Deliverable: completions, schema diagnostics, formatting, document links,
code actions on the web.

Landed as designed below, with these specifics:

- Server platform seam: `lsp-server/platform.ts` (Node IPC, local reads,
  default assets dir) vs `platform.browser.ts` (worker message port, no
  reads); the web server bundle swaps them with an esbuild resolve plugin and
  aliases `path` to `path-browserify`. All other server modules import from
  `vscode-languageserver` (root), which the `browser` field maps to the
  browser build.
- `lsp-server/project-files.ts` holds the client-pushed snapshot and the
  **path space**: `file:` documents keep their filesystem path; any other
  scheme maps to a virtual absolute path `/__vfs__/<scheme>/<authority>/<path>`
  so `xi:include` arithmetic (and `@pretextbook/schema`, which thinks in
  paths) works unchanged, and `pathToUri` maps back. The schema package is
  given the _bare_ virtual path for a non-`file:` document, not a `file:` URI
  of it — Node's `fileURLToPath` rejects `file:///__vfs__/…` on Windows for
  lacking a drive letter — and `fromSchemaUri` tolerates the drive letter Node's
  win32 `path.resolve` adds to included-file paths.
- Assets: `initializationOptions.assetsUri` + `pretext/readFile`. On the web
  host `workspace.fs` has no provider for the extension's `http(s):` assets, so
  the client's handler falls back to `fetch` for those schemes.
- `project-manifest.ts` was rewritten from `xml2js` (needs `events`,
  `timers`, `stream`) to `xast-util-from-xml`; same API, same spec.
- `pretext-tools.serverStatus` (an LSP `executeCommand`, callable as a VS Code
  command) reports assets URI, schema/grammar load state, snapshot size and
  the last validation outcome or error. It is what the web smoke test waits
  on, and the first thing to run when a host shows no diagnostics.
- The web smoke suite grew to seven tests: formatting, completions and schema
  diagnostics now come from the worker server.

Still desktop-only after Phase 1: `xi:include` href completions see only the
snapshot (`.ptx`/`.xml` with text; common asset types by name), not an
arbitrary `source/**` glob.

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

### Phase 2 — project views and import on the web ✅ (this branch)

Deliverable: the Outline (file and project scope) and Targets views, Import
and "Insert file as division" on the web.

Landed with these specifics:

- **One path space for both hosts.** The `/__vfs__/<scheme>/<authority>/…`
  mapping moved out of the server into `src/virtual-path.ts` (depends on
  `vscode-uri` only; `lsp-server/project-files.ts` re-exports it). `Project.root`
  and `Target.path`/`source` stay strings, but are now paths in that space:
  a real path on disk, a virtual one on github.dev. The manifest resolver and
  `project-outline.ts` keep their `path` arithmetic — the web build aliases
  `path` to `path-browserify` for every web bundle (`webResolve`), and
  `path-browserify` only reaches `process.cwd()` when no argument is absolute,
  which never happens here. The host turns a path back into a `Uri` with
  `Uri.parse(pathToUri(p))` (never `Uri.file`).
- **`project.ts` is host-neutral.** Discovery walks up from each workspace
  folder with `workspace.fs.stat` (same upward semantics as the old
  `getProjectFolder`), reads `project.ptx` with `workspace.fs.readFile`, and no
  longer imports `./cli` or `./utils`. The `~/.ptx/<version>` templates
  became a `ProjectProvider` (`project-system-default.ts`) that extension.ts
  registers with `addProjectProvider`; the browser entry registers none.
  `getProjectFolder` (sync `fs`) moved from `pure-utils.ts` to `utils.ts` so
  `pure-utils` is actually pure — the import wizard needs its
  `isSafeRelativePath`.
- **Shared view wiring.** `project-views.ts` registers both tree providers,
  their commands and the `project.ptx` watcher for both entry points, and
  returns the providers; both `activate`s return them as the extension's
  exports so the integration suites can read the trees back. Only the
  build/view buttons (`buildTreeTarget`, `viewTreeTarget`) stay in
  extension.ts and behind `!isWeb`.
- **Pandoc behind an interface.** `pandoc-bridge.ts` declares `PandocBridge`
  (`installed`, `convertUpload`, `convertFile`); `pandoc.ts` implements it as
  `desktopPandoc` (temp files, `--extract-media`), and extension.ts passes it
  to `cmdImport` / `cmdInsertFileAsDivision`. The browser entry passes
  nothing: the wizard reports pandoc unavailable and both flows read what
  `@pretextbook/import` converts itself. `Buffer.from(base64)` became an
  `atob` loop; `path.basename(fileName)` became `Utils.basename(uri)`.
- The manifest's `viewsWelcome`/`view/title`/`commandPalette` gating from
  Phase 0 was lifted for the outline, targets, import and insert commands.
- Tests: `src/test/web/project-views.test.ts` (targets listed from the
  virtual workspace, reveal-definition, project outline spliced across
  `xi:include` through `workspace.fs`, file outline, import panel opens) and a
  desktop twin in `src/test/suite/`. The fixture manifest gained a third
  target on `source/with-includes.ptx` so the project outline has an include
  to follow.

Still desktop-only after Phase 2: build/view buttons on target rows, the
status-bar quick pick, and everything in the "stay desktop-only" list above.

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
