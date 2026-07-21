/**
 * Live Preview panel for PreTeXt documents (the extension's main preview,
 * surfaced as "View Live Preview"; historically "Instant Preview").
 *
 * Unlike the experimental CLI-based preview (livePreview.ts), which shells
 * out to the `pretext` CLI and needs a Python installation, this preview runs
 * the official PreTeXt XSLT in-process via @pretextbook/pretext-html (libxslt
 * compiled to WebAssembly). No PreTeXt installation is required and rebuilds
 * take well under a second for article-sized documents.
 *
 * The transform runs in a separate worker process
 * (out/instant-preview-worker.mjs) because WebAssembly JSPI may need to be
 * enabled with a process-level flag; see launchWorker for how the runtime is
 * chosen. The worker prints the rendered standalone HTML page on stdout; we
 * hand it to a WebviewPanel. Assets (theme css/js, MathJax) come from public
 * CDNs, so the preview needs network access but no local build artifacts.
 */

import {
  ColorThemeKind,
  ConfigurationTarget,
  Disposable,
  Position,
  Range,
  TextEditorSelectionChangeKind,
  Uri,
  ViewColumn,
  Webview,
  WebviewPanel,
  window,
  workspace,
} from "vscode";
import { ChildProcess, fork, spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parseString } from "xml2js";
// Type-only: the runtime package is ESM and lives in the worker process; the
// extension host only ever sees the JSON-serialized map.
import type { SourceMapEntry } from "@pretextbook/pretext-html";
// Dependency-free leaf subpath, like ./theme below: the rewriter runs here in
// the host, on HTML the worker rendered, so it must not drag in the renderer.
import {
  missingAssetPlaceholder,
  rewriteAssetUrls,
  type AssetUrlResolver,
} from "@pretextbook/pretext-html/assets";
// The theme protocol is a dependency-free subpath (its own leaf module, no
// WASM renderer): importing the package root here would drag libxslt-wasm's
// top-level await into the CJS host bundle, which esbuild cannot bundle. This
// subpath pulls in only the message protocol. Drives the preview's light/dark
// theme from VS Code's active color theme.
import {
  previewThemeMessage,
  type PreviewTheme,
} from "@pretextbook/pretext-html/theme";
import { pretextOutputChannel, ptxSBItem } from "./ui";
import * as utils from "./utils";

let currentPanel: WebviewPanel | undefined;
let panelHasContent = false;
let saveWatcher: Disposable | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let currentSource: SourceInfo | undefined;

// Source map of the last successful render (see @pretextbook/pretext-html's
// sourcemap.ts): HTML element ids ↔ source file/line, powering two-way sync.
// Indexed by (normalized) file for cursor-follow and by id for click-to-source.
let sourceMapByFile: Map<string, SourceMapEntry[]> | undefined;
let sourceMapById: Map<string, SourceMapEntry> | undefined;
let selectionWatcher: Disposable | undefined;
let panelMessageWatcher: Disposable | undefined;
let themeWatcher: Disposable | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

// The persistent render worker. Kept alive across renders so the loaded WASM
// module and compiled stylesheet (the ~600ms cold start) are reused; each
// subsequent render is just a ~100ms transform.
let worker: ChildProcess | undefined;
let workerExtensionPath: string | undefined;
let nextRequestId = 1;
// Id of the render we are currently waiting on (undefined when idle). Only one
// render is in flight at a time; the worker serializes internally too.
let pendingRequestId: number | undefined;
let pendingStarted = 0;
// A newer render requested while one was in flight; collapses bursts of saves.
let renderQueued = false;
// Guards against a crash loop when the worker dies mid-render.
let crashRetries = 0;
let disposing = false;

const DEBOUNCE_MS = 400;
const SYNC_DEBOUNCE_MS = 150;
const MAX_CRASH_RETRIES = 2;

interface RenderResponse {
  id: number;
  ok: boolean;
  html?: string;
  error?: string;
  elapsedMs?: number;
  sourceMap?: SourceMapEntry[];
  /**
   * Real directories behind the `external/`/`generated/` URLs in `html`.
   * Absent for legacy projects that declare neither in their publication file.
   */
  assetDirs?: { external: string; generated: string };
}

interface SourceInfo {
  /**
   * The content file the preview follows (the last relevant .ptx in the
   * editor). Rendered directly — as a wrapped fragment when needed — in
   * "current-file" scope.
   */
  activePath: string;
  /** The project's main source file, when one could be located. */
  mainSourcePath?: string;
  /** Directory the transform may read from (project root). */
  projectDir: string;
  /** Publication file, when one was found. */
  publicationPath?: string;
}

type PreviewScope = "current-file" | "project";

function previewScope(): PreviewScope {
  const scope = workspace
    .getConfiguration("pretext-tools")
    .get<string>("instantPreview.scope", "current-file");
  return scope === "project" ? "project" : "current-file";
}

/**
 * Map VS Code's active color theme to a preview theme, so the preview matches
 * the editor. High-contrast variants follow their light/dark base. The
 * pretext-html theme bridge (injected into the page) applies this and then
 * follows the live messages posted by setupThemeWatcher.
 */
function currentPreviewTheme(): PreviewTheme {
  switch (window.activeColorTheme.kind) {
    case ColorThemeKind.Dark:
    case ColorThemeKind.HighContrast:
      return "dark";
    default:
      return "light";
  }
}

/**
 * Push the editor's theme to the open preview whenever the user switches VS
 * Code color themes — a live update, no re-render. The next render bakes the
 * new theme too (renderToPanel reads currentPreviewTheme), so a rebuild that
 * arrives first stays consistent.
 */
function setupThemeWatcher(): void {
  themeWatcher?.dispose();
  themeWatcher = window.onDidChangeActiveColorTheme(() => {
    void currentPanel?.webview.postMessage(
      previewThemeMessage(currentPreviewTheme()),
    );
  });
}

/**
 * Command handler: open (or reveal) the instant preview for the current
 * document's project.
 */
export async function cmdInstantPreview(extensionPath: string): Promise<void> {
  const source = resolveSource();
  if (!source) {
    window.showErrorMessage(
      "Open a PreTeXt (.ptx) file to use the live preview.",
    );
    return;
  }
  currentSource = source;

  if (!currentPanel) {
    currentPanel = window.createWebviewPanel(
      "pretextInstantPreview",
      "PreTeXt Live Preview",
      ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // The page loads images and media straight out of the project's asset
        // directories (see prepareWebviewHtml). The project root is the same
        // boundary the renderer's own mount enforces.
        localResourceRoots: [Uri.file(source.projectDir)],
      },
    );
    panelHasContent = false;
    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
      disposeInstantPreview();
    });
    // Reverse sync: the webview's bootstrap posts the ancestor id chain of a
    // double-clicked element; resolve it against the source map.
    panelMessageWatcher = currentPanel.webview.onDidReceiveMessage(
      (message: unknown) => {
        const msg = message as { command?: unknown; ids?: unknown };
        if (msg?.command === "revealSource" && Array.isArray(msg.ids)) {
          void revealSource(msg.ids.filter((x) => typeof x === "string"));
        }
      },
    );
    setupSaveWatcher(extensionPath);
    setupSelectionWatcher();
    setupThemeWatcher();
  } else {
    currentPanel.reveal(ViewColumn.Beside, true);
  }

  renderToPanel(extensionPath);
}

/**
 * Command handler: pick what the instant preview renders — the active source
 * file (wrapped as a standalone preview when it is a fragment) or the whole
 * project. Re-renders immediately when the preview panel is open.
 */
export async function cmdInstantPreviewScope(
  extensionPath: string,
): Promise<void> {
  const current = previewScope();
  const picked = await window.showQuickPick(
    [
      {
        label: "Current file",
        description:
          "Render only the active source file — fast, but numbering and " +
          "cross-references outside the file are placeholders",
        scope: "current-file" as PreviewScope,
        picked: current === "current-file",
      },
      {
        label: "Whole project",
        description: "Render the project's main source file with all includes",
        scope: "project" as PreviewScope,
        picked: current === "project",
      },
    ],
    { placeHolder: `Live preview scope (currently: ${current})` },
  );
  if (!picked || picked.scope === current) {
    return;
  }
  await workspace
    .getConfiguration("pretext-tools")
    .update(
      "instantPreview.scope",
      picked.scope,
      workspace.workspaceFolders
        ? ConfigurationTarget.Workspace
        : ConfigurationTarget.Global,
    );
  if (currentPanel) {
    currentSource = resolveSource() ?? currentSource;
    renderToPanel(extensionPath);
  }
}

/**
 * Work out what to build: walk up from the active editor to a project.ptx,
 * then read main source and publication file out of the manifest (with the
 * pretext-cli defaults as fallback). The active file itself is kept as
 * `activePath` for current-file scope; the worker's --fragment mode makes
 * xi:included fragments renderable on their own.
 */
function resolveSource(): SourceInfo | undefined {
  const editor = window.activeTextEditor;
  if (!editor || !editor.document.fileName.match(/\.(ptx|xml)$/)) {
    return currentSource; // keep previewing the last known project
  }
  const filePath = editor.document.fileName;
  // Manifest-ish files (project.ptx, publication files) are not renderable
  // content — keep following the previously active content file (their save
  // still triggers a rebuild through the save watcher).
  const activeRoot = rootElementOf(filePath);
  const isContent = activeRoot !== "project" && activeRoot !== "publication";

  const projectDir = utils.getProjectFolder(path.dirname(filePath));
  if (!projectDir) {
    if (!isContent) {
      return currentSource;
    }
    return { activePath: filePath, projectDir: path.dirname(filePath) };
  }

  let mainSourcePath: string | undefined;
  let publicationPath: string | undefined;
  try {
    const manifest = fs.readFileSync(
      path.join(projectDir, "project.ptx"),
      "utf8",
    );
    // parseString invokes its callback synchronously for a string input.
    parseString(manifest, (err, result) => {
      if (err || !result?.project) {
        return;
      }
      const project = result.project;
      const sourceDir = project.$?.source ?? "source";
      const publicationDir = project.$?.publication ?? "publication";
      // Prefer an html-format target's explicit source/publication.
      const targets = project.targets?.[0]?.target ?? [];
      const htmlTarget =
        targets.find((t: any) => t.$?.format === "html") ?? targets[0];
      const targetSource = htmlTarget?.$?.source ?? "main.ptx";
      const targetPublication = htmlTarget?.$?.publication ?? "publication.ptx";
      mainSourcePath = path.resolve(projectDir, sourceDir, targetSource);
      publicationPath = path.resolve(
        projectDir,
        publicationDir,
        targetPublication,
      );
    });
  } catch {
    // fall through to defaults below
  }

  if (!mainSourcePath || !fs.existsSync(mainSourcePath)) {
    const fallback = path.join(projectDir, "source", "main.ptx");
    if (fs.existsSync(fallback)) {
      mainSourcePath = fallback;
    } else if (isContent && isCompleteDocument(filePath)) {
      mainSourcePath = filePath;
    } else {
      mainSourcePath = undefined;
    }
  }
  if (!publicationPath || !fs.existsSync(publicationPath)) {
    publicationPath = undefined;
  }

  const activePath = isContent
    ? filePath
    : (currentSource?.activePath ?? mainSourcePath);
  if (!activePath) {
    return currentSource;
  }
  return { activePath, mainSourcePath, projectDir, publicationPath };
}

/**
 * Name of the root element of an XML file, or undefined when unreadable.
 * Reads only the first 4KB; a prolog comment longer than that gives
 * undefined, which callers treat conservatively.
 */
function rootElementOf(filePath: string): string | undefined {
  let head: string;
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(4096);
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
      head = buf.toString("utf8", 0, bytes);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
  // Strip the prolog (xml declaration, PIs, comments, doctype) and look at
  // the first real element.
  const prolog = head
    .replace(/<\?[\s\S]*?\?>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!DOCTYPE[^>]*>/gi, " ");
  return prolog.match(/<\s*([A-Za-z][\w:-]*)/)?.[1];
}

/**
 * True when the file is a complete PreTeXt document (<pretext> or legacy
 * <mathbook> root element) rather than an xi:included fragment.
 */
function isCompleteDocument(filePath: string): boolean {
  const root = rootElementOf(filePath);
  return root === "pretext" || root === "mathbook";
}

/** A runtime that can host the render worker, and how to invoke it. */
type NodeLaunch = {
  command: string;
  flags: string[];
  /** Extra environment this runtime needs (Electron's run-as-node switch). */
  env: NodeJS.ProcessEnv;
};

/** Cached result of probing which runtime/flags give us WebAssembly JSPI. */
let nodeLaunch: NodeLaunch | undefined;

/**
 * Flag spellings that have enabled JSPI across the V8 versions we may meet.
 * V8 renamed the flag mid-stream (--experimental-wasm-stack-switching became
 * --experimental-wasm-jspi), and the empty entry covers runtimes new enough to
 * have JSPI on by default. Node exits with "bad option" on a flag its V8 does
 * not know, so an unsupported spelling simply fails its probe and we move on.
 *
 * Note a runtime can accept the flag and still lack the API we need: V8 12.4
 * (all of Node 22) has only the older Suspender-era JSPI, so it takes the flag
 * and still reports no WebAssembly.Suspending. Probing for the API rather than
 * sniffing a version number is what keeps that case honest.
 */
const JSPI_FLAG_CANDIDATES: string[][] = [
  ["--experimental-wasm-jspi"],
  ["--experimental-wasm-stack-switching"],
  [],
];

/**
 * Launch the render worker in a process where WebAssembly JSPI is available.
 *
 * Almost no runtime we meet has JSPI on by default -- even V8 13.6 (Node 24)
 * still needs --experimental-wasm-jspi -- so this fast path, forking with the
 * flags already in effect, is mostly reserved for future runtimes that enable
 * it unconditionally. Everything else goes through resolveNodeLaunch, which
 * finds a runtime/flag pair that does expose WebAssembly.Suspending.
 *
 * Note the fallback is not "a system Node": resolveNodeLaunch prefers the
 * runtime already hosting this extension, so the common case needs no separate
 * Node installation at all.
 */
function launchWorker(
  workerPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): ChildProcess {
  // The extension's ts lib has no WebAssembly declarations; go via globalThis.
  const wasm = (globalThis as { WebAssembly?: object }).WebAssembly;
  if (wasm && "Suspending" in wasm) {
    // fork() always sets up an IPC channel; silent pipes stdio so we can read
    // the worker's stderr for diagnostics.
    return fork(workerPath, args, { execArgv: [], silent: true, env });
  }
  const { command, flags, env: runtimeEnv } = resolveNodeLaunch();
  // The 'ipc' stdio slot gives the spawned Node the same message channel a
  // fork would, so the serve protocol works identically on either path.
  return spawn(command, [...flags, workerPath, ...args], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...env, ...runtimeEnv },
  });
}

/**
 * Return the live render worker, launching it (in persistent serve mode) if
 * needed and wiring its message/exit handlers exactly once. Returns undefined
 * if the worker could not be started (an error is surfaced to the user).
 */
function ensureWorker(extensionPath: string): ChildProcess | undefined {
  if (worker) {
    return worker;
  }
  workerExtensionPath = extensionPath;
  const workerPath = path.join(
    extensionPath,
    "out",
    "instant-preview-worker.mjs",
  );
  let child: ChildProcess;
  try {
    child = launchWorker(workerPath, ["--serve"], {
      ...process.env,
      PRETEXT_HTML_ASSETS: path.join(extensionPath, "assets", "pretext-html"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    utils.updateStatusBarItem(ptxSBItem, "ready");
    pretextOutputChannel.appendLine(`[Instant Preview] ${message}`);
    window.showErrorMessage(message);
    return undefined;
  }

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) {
      pretextOutputChannel.appendLine(`[Instant Preview] ${text}`);
    }
  });

  child.on("message", (message: unknown) =>
    handleWorkerMessage(message as RenderResponse),
  );

  child.on("error", (err) => {
    pretextOutputChannel.appendLine(`[Instant Preview] ${String(err)}`);
    if (worker === child) {
      worker = undefined;
    }
    pendingRequestId = undefined;
    utils.updateStatusBarItem(ptxSBItem, "ready");
    window.showErrorMessage(
      "Instant preview could not start its Node.js worker. Check the PreTeXt output log.",
    );
  });

  child.on("exit", (code, signal) => {
    if (worker === child) {
      worker = undefined;
    }
    if (disposing) {
      return;
    }
    // Unexpected death (crash, OOM). If it took a render down with it, retry a
    // bounded number of times; otherwise the next render simply relaunches.
    pretextOutputChannel.appendLine(
      `[Instant Preview] Worker exited unexpectedly ` +
        `(code=${code ?? "null"}, signal=${signal ?? "null"}).`,
    );
    const wasRendering = pendingRequestId !== undefined;
    pendingRequestId = undefined;
    if ((wasRendering || renderQueued) && crashRetries < MAX_CRASH_RETRIES) {
      crashRetries += 1;
      renderQueued = false;
      pretextOutputChannel.appendLine(
        `[Instant Preview] Restarting worker (attempt ${crashRetries}).`,
      );
      if (workerExtensionPath) {
        renderToPanel(workerExtensionPath);
      }
    } else if (wasRendering || renderQueued) {
      renderQueued = false;
      utils.updateStatusBarItem(ptxSBItem, "ready");
      window
        .showErrorMessage(
          "Instant preview worker keeps crashing. Check the PreTeXt output log.",
          "Show Log",
        )
        .then((choice) => {
          if (choice === "Show Log") {
            pretextOutputChannel.show();
          }
        });
    }
  });

  worker = child;
  return worker;
}

/** Handle a render response from the worker (see handleRenderResponse). */
function handleWorkerMessage(message: RenderResponse): void {
  if (
    !message ||
    typeof message.id !== "number" ||
    message.id !== pendingRequestId
  ) {
    // Stale response from a superseded/relaunched render — ignore.
    return;
  }
  pendingRequestId = undefined;
  handleRenderResponse(message);
  if (renderQueued && workerExtensionPath) {
    renderQueued = false;
    renderToPanel(workerExtensionPath);
  }
}

/**
 * Ask a candidate runtime whether it exposes JSPI under the given flags.
 * Returns a human-readable reason when it does not, for the output log.
 */
function probeJspi(
  command: string,
  flags: string[],
  env: NodeJS.ProcessEnv,
): { ok: boolean; detail: string } {
  const probe = spawnSync(
    command,
    [...flags, "-p", "'Suspending' in WebAssembly"],
    { encoding: "utf8", timeout: 10000, env: { ...process.env, ...env } },
  );
  if (probe.error) {
    // Typically ENOENT (no such binary on this process's PATH).
    return { ok: false, detail: probe.error.message };
  }
  if (probe.status === 0 && probe.stdout.trim() === "true") {
    return { ok: true, detail: "ok" };
  }
  const reason = (probe.stderr || probe.stdout).trim() || "no JSPI";
  return { ok: false, detail: `exit ${probe.status}: ${reason}` };
}

/**
 * Find a Node runtime with JSPI support for the render worker.
 *
 * Tries, in order: an explicitly configured nodePath, the runtime already
 * hosting this extension (VS Code Server's bundled Node in a remote/Codespaces
 * window, Electron on the desktop — which runs as plain Node when
 * ELECTRON_RUN_AS_NODE is set), then `node` from PATH. Each is probed against
 * every flag spelling in JSPI_FLAG_CANDIDATES. Using the extension host's own
 * runtime mirrors what pretext-html's CLI does with process.execPath, and lets
 * the preview work with no separate Node installation at all.
 *
 * Throws with install/configuration advice, having logged every attempt.
 */
function resolveNodeLaunch(): NodeLaunch {
  if (nodeLaunch) {
    return nodeLaunch;
  }
  const configured = workspace
    .getConfiguration("pretext-tools")
    .get<string>("instantPreview.nodePath")
    ?.trim();

  const candidates: {
    command: string;
    env: NodeJS.ProcessEnv;
    label: string;
  }[] = [];
  if (configured) {
    candidates.push({ command: configured, env: {}, label: configured });
  }
  candidates.push({
    command: process.execPath,
    // Harmless on a plain Node; required for Electron to behave as Node.
    env: { ELECTRON_RUN_AS_NODE: "1" },
    label: `extension host runtime (${process.execPath})`,
  });
  candidates.push({ command: "node", env: {}, label: '"node" on PATH' });

  const attempts: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.command)) {
      continue;
    }
    seen.add(candidate.command);
    for (const flags of JSPI_FLAG_CANDIDATES) {
      const shown = flags.join(" ") || "(no flags)";
      const result = probeJspi(candidate.command, flags, candidate.env);
      if (result.ok) {
        pretextOutputChannel.appendLine(
          `[Instant Preview] Render worker will use ${candidate.label} ${shown}.`,
        );
        nodeLaunch = {
          command: candidate.command,
          flags,
          env: candidate.env,
        };
        return nodeLaunch;
      }
      attempts.push(`${candidate.label} ${shown} -> ${result.detail}`);
    }
  }

  pretextOutputChannel.appendLine(
    `[Instant Preview] No runtime with WebAssembly JSPI found. Attempts:\n  ` +
      attempts.join("\n  "),
  );
  throw new Error(
    `The live preview needs a Node.js runtime with WebAssembly JSPI, and none ` +
      `of the ${attempts.length} runtime/flag combinations tried provided one. ` +
      `See the PreTeXt output log for what each attempt reported. Updating VS ` +
      `Code is usually the easiest fix, since it supplies the runtime this ` +
      `preview prefers. Otherwise install Node.js 24 or later (Node 22 cannot ` +
      `do this -- its V8 predates the WebAssembly.Suspending API) and, if it ` +
      `is not on PATH, set "pretext-tools.instantPreview.nodePath" to its ` +
      `absolute path (that setting is machine-scoped, so in a remote or ` +
      `Codespaces window set it under the "Remote" tab, not "User").`,
  );
}

/**
 * Send a render request to the persistent worker. If one is already in flight,
 * remember to run once more when it finishes (collapsing a burst of saves into
 * a single rebuild).
 */
function renderToPanel(extensionPath: string): void {
  if (!currentSource || !currentPanel) {
    return;
  }
  if (pendingRequestId !== undefined) {
    renderQueued = true;
    return;
  }

  const child = ensureWorker(extensionPath);
  if (!child) {
    return;
  }

  const scope = previewScope();
  const renderPath =
    scope === "project"
      ? (currentSource.mainSourcePath ?? currentSource.activePath)
      : currentSource.activePath;

  currentPanel.title =
    scope === "project"
      ? "PreTeXt Preview: project"
      : `PreTeXt Preview: ${path.basename(renderPath)}`;

  utils.updateStatusBarItem(ptxSBItem, "building");
  pretextOutputChannel.appendLine(
    `[Instant Preview] Rendering ${renderPath} (scope: ${scope})` +
      (currentSource.publicationPath
        ? ` (publication: ${path.basename(currentSource.publicationPath)})`
        : ""),
  );

  const id = nextRequestId++;
  pendingRequestId = id;
  pendingStarted = Date.now();
  // --fragment behaviour: a lone chapter/section renders as a wrapped preview
  // document; complete documents are unaffected.
  const request = {
    id,
    type: "render" as const,
    sourcePath: renderPath,
    projectDir: currentSource.projectDir,
    publicationPath: currentSource.publicationPath,
    // Anchors the publication file's relative asset directories. Without it a
    // fragment in a subdirectory resolves "../generated-assets/" from its own
    // folder and every generated image comes out blank.
    mainSourcePath: currentSource.mainSourcePath,
    fragment: true,
    // The worker lifts <docinfo> (LaTeX macros, custom settings) from the
    // main file — resolving xi:includes — and injects it into the fragment
    // wrapper. Only consulted when renderPath is a fragment (current-file
    // scope); a complete document carries its own docinfo, so it is ignored
    // there, including project scope where renderPath is the main file itself.
    docinfoSourcePath: currentSource.mainSourcePath,
    // id ↔ file/line map for two-way sync; costs a few ms per render.
    sourceMap: true,
    // Bake the editor's current theme into the page so it opens matching VS
    // Code (no light-then-dark flash). setupThemeWatcher posts live updates
    // for subsequent theme switches without a re-render.
    theme: currentPreviewTheme(),
  };
  child.send(request, (err) => {
    if (err && pendingRequestId === id) {
      // The channel died between ensureWorker and send; the exit handler will
      // relaunch/retry. Just clear this in-flight marker.
      pendingRequestId = undefined;
      pretextOutputChannel.appendLine(
        `[Instant Preview] Failed to send render request: ${String(err)}`,
      );
    }
  });
}

/** Apply a worker render response to the panel and status bar. */
function handleRenderResponse(message: RenderResponse): void {
  if (message.ok && message.html && currentPanel) {
    const html = message.html;
    if (!html.includes("</html>")) {
      // Defensive: never blank the panel on incomplete output.
      utils.updateStatusBarItem(ptxSBItem, "ready");
      pretextOutputChannel.appendLine(
        `[Instant Preview] Worker returned incomplete HTML ` +
          `(${html.length} bytes); keeping previous preview.`,
      );
      return;
    }
    crashRetries = 0;
    applySourceMap(message.sourceMap);
    updatePanelContent(
      prepareWebviewHtml(
        html,
        currentPanel.webview,
        currentSource?.projectDir ?? "",
        message.assetDirs,
      ),
    );
    utils.updateStatusBarItem(ptxSBItem, "success");
    pretextOutputChannel.appendLine(
      `[Instant Preview] Rebuilt in ${message.elapsedMs ?? Date.now() - pendingStarted}ms`,
    );
    return;
  }

  utils.updateStatusBarItem(ptxSBItem, "ready");
  if (message.error) {
    pretextOutputChannel.appendLine(`[Instant Preview] ${message.error}`);
  }
  window
    .showErrorMessage(
      "Instant preview build failed. Check the PreTeXt output log.",
      "Show Log",
    )
    .then((choice) => {
      if (choice === "Show Log") {
        pretextOutputChannel.show();
      }
    });
}

/**
 * Deliver a freshly rendered page to the panel. The first page is set via
 * webview.html; after that, the new page is posted into the live webview,
 * whose bootstrap script rewrites the document in place
 * (document.open/write/close). Replacing webview.html on every rebuild forces
 * a full webview reload, which VS Code sometimes never completes — the panel
 * just goes blank — and also refetches all CDN assets and loses scroll.
 */
function updatePanelContent(preparedHtml: string): void {
  const panel = currentPanel;
  if (!panel) {
    return;
  }
  if (!panelHasContent) {
    panel.webview.html = preparedHtml;
    panelHasContent = true;
    return;
  }
  Promise.resolve(
    panel.webview.postMessage({ command: "update", html: preparedHtml }),
  ).then((delivered) => {
    if (!delivered && currentPanel === panel) {
      // Webview not live (should not happen with retainContextWhenHidden,
      // but don't drop the render on the floor).
      panel.webview.html = preparedHtml;
    }
  });
}

/**
 * Point the page's `external/` and `generated/` asset URLs at files on disk.
 *
 * A portable build inlines latex-image and prefigure SVGs, but author-supplied
 * images and media (and sageplot/asymptote output) stay as relative URLs into
 * output directories the preview never creates. Rewriting them to webview URIs
 * lets the panel load the real files — lazily, and without re-sending image
 * bytes through postMessage on every rebuild the way data: URIs would.
 */
function assetUriResolver(
  webview: Webview,
  assetDirs: { external: string; generated: string },
  projectDir: string,
): AssetUrlResolver {
  return (kind, relPath) => {
    const filePath = path.resolve(assetDirs[kind], relPath);
    // Containment: a "../" in an @source must not turn into a webview URI for
    // an arbitrary file. localResourceRoots would refuse it anyway; failing
    // here keeps the page honest about what it asked for.
    const root = path.resolve(projectDir);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return undefined;
    }
    // A project whose images have never been built is the normal case here,
    // not an error: `pretext generate` is a separate Python-side step this
    // preview exists to avoid needing. Substituting a placeholder that names
    // the missing asset beats the browser's broken-image glyph, which reads
    // as "the preview is broken". One stat per asset per rebuild.
    if (!fs.existsSync(filePath)) {
      return missingAssetPlaceholder(kind, relPath);
    }
    return webview.asWebviewUri(Uri.file(filePath)).toString();
  };
}

/**
 * Adapt the standalone page for a VS Code webview: retarget project assets at
 * real files, allow CDN assets through a CSP meta tag, and add a bootstrap
 * script that (a) preserves the scroll position across rebuilds and (b)
 * applies "update" messages from the extension by rewriting the document in
 * place (see updatePanelContent).
 */
function prepareWebviewHtml(
  html: string,
  webview: Webview,
  projectDir: string,
  assetDirs?: { external: string; generated: string },
): string {
  const page = assetDirs
    ? rewriteAssetUrls(html, assetUriResolver(webview, assetDirs, projectDir))
    : html;
  const csp = [
    "default-src 'none'",
    // cspSource covers the rewritten project assets; https:/data: the CDN.
    `img-src ${webview.cspSource} https: data:`,
    `media-src ${webview.cspSource} https:`,
    "script-src https: 'unsafe-inline' 'unsafe-eval'",
    "style-src https: 'unsafe-inline'",
    "font-src https: data:",
    "connect-src https:",
    // asymptote emits 3d output as an <iframe> into the generated directory.
    `frame-src ${webview.cspSource} https:`,
  ].join("; ");
  const cspTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  // Runs once per document, including documents written by the update path
  // below (the extension injects this same script into every rendered page).
  // acquireVsCodeApi may only be called once per webview *session*, and
  // document.write keeps the same Window, so the api handle is stashed on
  // window. Likewise the old message listener survives the rewrite in some
  // engines, so it is explicitly removed before re-adding.
  const bootstrapScript = [
    // Faint amber flash on the element the forward sync scrolls to; the
    // animation fades to nothing so the page returns to normal on its own.
    "<style>",
    "@keyframes ptx-sync-flash {",
    "  from { background-color: rgba(255, 193, 61, 0.18);",
    "         box-shadow: 0 0 0 5px rgba(255, 193, 61, 0.18); }",
    "  to   { background-color: transparent; box-shadow: none; }",
    "}",
    ".ptx-sync-flash { animation: ptx-sync-flash 1.6s ease-out;",
    "  border-radius: 4px; }",
    "</style>",
    "<script>",
    "(function () {",
    "  var api = window.__ptxPreviewApi ||",
    "    (window.__ptxPreviewApi = acquireVsCodeApi());",
    "  var prior = api.getState();",
    "  function restoreScroll() {",
    "    if (prior && typeof prior.scrollY === 'number') {",
    "      window.scrollTo(0, prior.scrollY);",
    "    }",
    "  }",
    "  restoreScroll();",
    "  window.addEventListener('load', restoreScroll);",
    "  var ticking = false;",
    "  window.addEventListener('scroll', function () {",
    "    if (ticking) { return; }",
    "    ticking = true;",
    "    setTimeout(function () {",
    "      api.setState({ scrollY: window.scrollY });",
    "      ticking = false;",
    "    }, 100);",
    "  });",
    "  if (window.__ptxUpdateHandler) {",
    "    window.removeEventListener('message', window.__ptxUpdateHandler);",
    "  }",
    "  window.__ptxUpdateHandler = function (event) {",
    "    var msg = event.data;",
    "    if (!msg) { return; }",
    "    if (msg.command === 'scrollTo' && msg.ids && msg.ids.length) {",
    "      // Forward sync: try the id chain innermost-first; not every",
    "      // element in the source map gets an HTML id.",
    "      for (var k = 0; k < msg.ids.length; k++) {",
    "        var target = document.getElementById(msg.ids[k]);",
    "        if (target) {",
    "          // Center small elements; for anything too tall to fit (a",
    "          // subsection, a p with a long list) centering would push its",
    "          // top — the part that was clicked — above the viewport, so",
    "          // pin the top just below the window top instead.",
    "          var rect = target.getBoundingClientRect();",
    "          if (rect.height > window.innerHeight - 140) {",
    "            window.scrollTo(0, rect.top + window.pageYOffset - 70);",
    "          } else {",
    "            target.scrollIntoView({ block: 'center' });",
    "          }",
    "          if (window.__ptxFlashEl && window.__ptxFlashEl.classList) {",
    "            window.__ptxFlashEl.classList.remove('ptx-sync-flash');",
    "          }",
    "          void target.offsetWidth; // restart the fade animation",
    "          target.classList.add('ptx-sync-flash');",
    "          window.__ptxFlashEl = target;",
    "          break;",
    "        }",
    "      }",
    "      return;",
    "    }",
    "    if (msg.command !== 'update' || typeof msg.html !== 'string') {",
    "      return;",
    "    }",
    "    api.setState({ scrollY: window.scrollY });",
    "    document.open();",
    "    document.write(msg.html);",
    "    document.close();",
    "  };",
    "  window.addEventListener('message', window.__ptxUpdateHandler);",
    "  // Reverse sync: report a double-clicked element's ancestor id chain",
    "  // (innermost first); the extension resolves it against the source map.",
    "  if (window.__ptxSyncClickHandler) {",
    "    window.removeEventListener('dblclick', window.__ptxSyncClickHandler);",
    "  }",
    "  window.__ptxSyncClickHandler = function (event) {",
    "    var ids = [];",
    "    var el = event.target;",
    "    while (el && el.getAttribute && ids.length < 8) {",
    "      var id = el.getAttribute('id');",
    "      if (id) { ids.push(id); }",
    "      el = el.parentElement;",
    "    }",
    "    if (ids.length) {",
    "      api.postMessage({ command: 'revealSource', ids: ids });",
    "    }",
    "  };",
    "  window.addEventListener('dblclick', window.__ptxSyncClickHandler);",
    "})();",
    "</script>",
  ].join("\n");

  return page
    .replace(/<head([^>]*)>/i, `<head$1>\n${cspTag}`)
    .replace(/<\/body>/i, `${bootstrapScript}\n</body>`);
}

/** Rebuild on save of any .ptx/.xml file (debounced), unless disabled. */
function setupSaveWatcher(extensionPath: string): void {
  saveWatcher?.dispose();
  saveWatcher = workspace.onDidSaveTextDocument((document) => {
    if (!document.fileName.match(/\.(ptx|xml)$/) || !currentPanel) {
      return;
    }
    const autoRefresh: boolean =
      workspace
        .getConfiguration("pretext-tools")
        .get("instantPreview.autoRefresh") ?? true;
    if (!autoRefresh) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      // Re-resolve in case the user switched projects since opening the panel
      currentSource = resolveSource() ?? currentSource;
      renderToPanel(extensionPath);
    }, DEBOUNCE_MS);
  });
}

/**
 * Case/separator-insensitive key for comparing the map's worker-resolved
 * absolute paths with editor document paths (drive-letter case differs on
 * Windows depending on who produced the path).
 */
function fileKey(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Index a freshly received source map for both sync directions. */
function applySourceMap(map: SourceMapEntry[] | undefined): void {
  if (!map) {
    return; // keep the previous map rather than losing sync entirely
  }
  sourceMapByFile = new Map();
  sourceMapById = new Map();
  for (const entry of map) {
    sourceMapById.set(entry.id, entry);
    const key = fileKey(entry.file);
    const list = sourceMapByFile.get(key);
    if (list) {
      list.push(entry);
    } else {
      sourceMapByFile.set(key, [entry]);
    }
  }
}

/**
 * Forward sync: follow the cursor. Only user-initiated selection changes
 * (mouse/keyboard) count — programmatic reveals, including our own reverse
 * sync, would otherwise bounce the preview around.
 */
function setupSelectionWatcher(): void {
  selectionWatcher?.dispose();
  selectionWatcher = window.onDidChangeTextEditorSelection((event) => {
    if (!currentPanel || !sourceMapByFile) {
      return;
    }
    if (
      event.kind !== TextEditorSelectionChangeKind.Mouse &&
      event.kind !== TextEditorSelectionChangeKind.Keyboard
    ) {
      return;
    }
    const fileName = event.textEditor.document.fileName;
    if (!fileName.match(/\.(ptx|xml)$/)) {
      return;
    }
    const line = (event.selections[0]?.active.line ?? 0) + 1;
    if (syncTimer) {
      clearTimeout(syncTimer);
    }
    syncTimer = setTimeout(
      () => syncPreviewToCursor(fileName, line),
      SYNC_DEBOUNCE_MS,
    );
  });
}

/**
 * Scroll the preview to the element nearest the cursor: the last map entry
 * for this file starting at or before the line (entries are in document
 * order, so that is the deepest/nearest element above the cursor). The
 * webview walks the id chain outward until one exists in the page — not
 * every element gets an HTML id.
 */
function syncPreviewToCursor(fileName: string, line: number): void {
  if (!currentPanel || !sourceMapByFile || !sourceMapById) {
    return;
  }
  const entries = sourceMapByFile.get(fileKey(fileName));
  if (!entries || entries.length === 0) {
    return; // file not part of the last render (other project, other scope)
  }
  let entry: SourceMapEntry | undefined;
  for (const candidate of entries) {
    if (candidate.line <= line) {
      entry = candidate;
    }
  }
  entry = entry ?? entries[0];
  const ids = [entry.id];
  let parent = entry.parent;
  for (let depth = 0; parent && depth < 6; depth++) {
    ids.push(parent);
    parent = sourceMapById.get(parent)?.parent;
  }
  void currentPanel.webview.postMessage({ command: "scrollTo", ids });
}

/**
 * Reverse sync: a double-click in the preview arrives as the element's
 * ancestor id chain (innermost first); open the innermost one we can map.
 */
async function revealSource(ids: string[]): Promise<void> {
  if (!sourceMapById) {
    return;
  }
  let entry: SourceMapEntry | undefined;
  for (const id of ids) {
    entry = sourceMapById.get(id);
    if (entry) {
      break;
    }
  }
  if (!entry) {
    return;
  }
  try {
    const document = await workspace.openTextDocument(entry.file);
    const position = new Position(
      entry.line - 1,
      Math.max(0, entry.column - 1),
    );
    await window.showTextDocument(document, {
      viewColumn: ViewColumn.One,
      selection: new Range(position, position),
    });
  } catch (err) {
    pretextOutputChannel.appendLine(
      `[Instant Preview] Could not open ${entry.file}: ${String(err)}`,
    );
  }
}

/** Clean up watchers and shut down the persistent worker. */
export function disposeInstantPreview(): void {
  saveWatcher?.dispose();
  saveWatcher = undefined;
  selectionWatcher?.dispose();
  selectionWatcher = undefined;
  panelMessageWatcher?.dispose();
  panelMessageWatcher = undefined;
  themeWatcher?.dispose();
  themeWatcher = undefined;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = undefined;
  }
  sourceMapByFile = undefined;
  sourceMapById = undefined;
  disposing = true;
  if (worker) {
    // disconnect() lets the worker exit cleanly on its 'disconnect' handler;
    // kill() is the backstop if it is wedged.
    worker.disconnect?.();
    if (!worker.killed) {
      worker.kill();
    }
    worker = undefined;
  }
  pendingRequestId = undefined;
  renderQueued = false;
  crashRetries = 0;
  currentSource = undefined;
  panelHasContent = false;
  workerExtensionPath = undefined;
  disposing = false;
}
