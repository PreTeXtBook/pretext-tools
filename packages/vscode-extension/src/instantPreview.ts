/**
 * Instant Preview panel for PreTeXt documents.
 *
 * Unlike the Live Preview (livePreview.ts), which shells out to the `pretext`
 * CLI and needs a Python installation, the Instant Preview runs the official
 * PreTeXt XSLT in-process via @pretextbook/pretext-html (libxslt compiled to
 * WebAssembly). No PreTeXt installation is required and rebuilds take well
 * under a second for article-sized documents.
 *
 * The transform runs in a separate worker process
 * (out/instant-preview-worker.mjs) because WebAssembly JSPI may need to be
 * enabled with a process-level flag; see launchWorker for how the runtime is
 * chosen. The worker prints the rendered standalone HTML page on stdout; we
 * hand it to a WebviewPanel. Assets (theme css/js, MathJax) come from public
 * CDNs, so the preview needs network access but no local build artifacts.
 */

import {
  ConfigurationTarget,
  Disposable,
  ViewColumn,
  WebviewPanel,
  window,
  workspace,
} from "vscode";
import { ChildProcess, fork, spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parseString } from "xml2js";
import { pretextOutputChannel, ptxSBItem } from "./ui";
import * as utils from "./utils";

let currentPanel: WebviewPanel | undefined;
let panelHasContent = false;
let saveWatcher: Disposable | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let currentSource: SourceInfo | undefined;

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
const MAX_CRASH_RETRIES = 2;

interface RenderResponse {
  id: number;
  ok: boolean;
  html?: string;
  error?: string;
  elapsedMs?: number;
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
 * Command handler: open (or reveal) the instant preview for the current
 * document's project.
 */
export async function cmdInstantPreview(extensionPath: string): Promise<void> {
  const experimentalEnabled = workspace
    .getConfiguration("pretext-tools")
    .get<boolean>("experimentalFeatures", false);
  if (!experimentalEnabled) {
    window.showInformationMessage(
      "The instant preview is experimental. Enable the " +
        '"pretext-tools.experimentalFeatures" setting to try it.',
    );
    return;
  }

  const source = resolveSource();
  if (!source) {
    window.showErrorMessage(
      "Open a PreTeXt (.ptx) file to use the instant preview.",
    );
    return;
  }
  currentSource = source;

  if (!currentPanel) {
    currentPanel = window.createWebviewPanel(
      "pretextInstantPreview",
      "PreTeXt Instant Preview",
      ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panelHasContent = false;
    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
      disposeInstantPreview();
    });
    setupSaveWatcher(extensionPath);
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
    { placeHolder: `Instant preview scope (currently: ${current})` },
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

/** Cached result of probing which runtime/flags give us WebAssembly JSPI. */
let nodeLaunch: { command: string; flags: string[] } | undefined;

/**
 * Launch the render worker in a process where WebAssembly JSPI is available.
 *
 * Runtimes disagree on how to get JSPI: Node 22 needs the
 * --experimental-wasm-jspi flag, while V8 >= 13.7 (Chromium >= 137, so any
 * recent VS Code, and eventually Node itself) has JSPI on by default and
 * rejects that flag as a "bad option". fork() reuses VS Code's own Electron
 * binary in run-as-node mode, so when this extension host already exposes
 * WebAssembly.Suspending we can simply fork with no flags. Otherwise (older
 * VS Code) we fall back to a system Node, probing once for the right flags.
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
  const { command, flags } = resolveNodeLaunch();
  // The 'ipc' stdio slot gives the spawned Node the same message channel a
  // fork would, so the serve protocol works identically on either path.
  return spawn(command, [...flags, workerPath, ...args], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env,
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
 * Find an external Node with JSPI support (used only when VS Code's own
 * runtime lacks it). Throws with install/configuration advice on failure.
 */
function resolveNodeLaunch(): { command: string; flags: string[] } {
  if (nodeLaunch) {
    return nodeLaunch;
  }
  const command =
    workspace
      .getConfiguration("pretext-tools")
      .get<string>("instantPreview.nodePath") || "node";
  for (const flags of [["--experimental-wasm-jspi"], []]) {
    const probe = spawnSync(
      command,
      [...flags, "-p", "'Suspending' in WebAssembly"],
      { encoding: "utf8", timeout: 10000 },
    );
    if (probe.status === 0 && probe.stdout.trim() === "true") {
      nodeLaunch = { command, flags };
      return nodeLaunch;
    }
  }
  throw new Error(
    `The instant preview needs a Node.js runtime with WebAssembly JSPI, ` +
      `and "${command}" does not provide one. Install Node.js 22 or later, ` +
      `or point the "pretext-tools.instantPreview.nodePath" setting at one.`,
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
    fragment: true,
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
    updatePanelContent(prepareWebviewHtml(html));
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
 * Adapt the standalone page for a VS Code webview: allow CDN assets through
 * a CSP meta tag, and add a bootstrap script that (a) preserves the scroll
 * position across rebuilds and (b) applies "update" messages from the
 * extension by rewriting the document in place (see updatePanelContent).
 */
function prepareWebviewHtml(html: string): string {
  const csp = [
    "default-src 'none'",
    "img-src https: data:",
    "media-src https:",
    "script-src https: 'unsafe-inline' 'unsafe-eval'",
    "style-src https: 'unsafe-inline'",
    "font-src https: data:",
    "connect-src https:",
    "frame-src https:",
  ].join("; ");
  const cspTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  // Runs once per document, including documents written by the update path
  // below (the extension injects this same script into every rendered page).
  // acquireVsCodeApi may only be called once per webview *session*, and
  // document.write keeps the same Window, so the api handle is stashed on
  // window. Likewise the old message listener survives the rewrite in some
  // engines, so it is explicitly removed before re-adding.
  const bootstrapScript = [
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
    "    if (!msg || msg.command !== 'update' ||",
    "        typeof msg.html !== 'string') {",
    "      return;",
    "    }",
    "    api.setState({ scrollY: window.scrollY });",
    "    document.open();",
    "    document.write(msg.html);",
    "    document.close();",
    "  };",
    "  window.addEventListener('message', window.__ptxUpdateHandler);",
    "})();",
    "</script>",
  ].join("\n");

  return html
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

/** Clean up watchers and shut down the persistent worker. */
export function disposeInstantPreview(): void {
  saveWatcher?.dispose();
  saveWatcher = undefined;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
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
