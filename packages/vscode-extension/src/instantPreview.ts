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
let saveWatcher: Disposable | undefined;
let renderProcess: ChildProcess | undefined;
let renderQueued = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let currentSource: SourceInfo | undefined;

const DEBOUNCE_MS = 400;

interface SourceInfo {
  /** Root source file handed to the transform. */
  sourcePath: string;
  /** Directory the transform may read from (project root). */
  projectDir: string;
  /** Publication file, when one was found. */
  publicationPath?: string;
}

/**
 * Command handler: open (or reveal) the instant preview for the current
 * document's project.
 */
export async function cmdInstantPreview(extensionPath: string): Promise<void> {
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
 * Work out what to build: walk up from the active editor to a project.ptx,
 * then read main source and publication file out of the manifest (with the
 * pretext-cli defaults as fallback). Files without a project build alone.
 */
function resolveSource(): SourceInfo | undefined {
  const editor = window.activeTextEditor;
  if (!editor || !editor.document.fileName.match(/\.(ptx|xml)$/)) {
    return currentSource; // keep previewing the last known project
  }
  const filePath = editor.document.fileName;
  const projectDir = utils.getProjectFolder(path.dirname(filePath));
  if (!projectDir) {
    return { sourcePath: filePath, projectDir: path.dirname(filePath) };
  }

  let sourcePath: string | undefined;
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
      sourcePath = path.resolve(projectDir, sourceDir, targetSource);
      publicationPath = path.resolve(
        projectDir,
        publicationDir,
        targetPublication,
      );
    });
  } catch {
    // fall through to defaults below
  }

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const fallback = path.join(projectDir, "source", "main.ptx");
    sourcePath = fs.existsSync(fallback) ? fallback : filePath;
  }
  if (!publicationPath || !fs.existsSync(publicationPath)) {
    publicationPath = undefined;
  }
  return { sourcePath, projectDir, publicationPath };
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
    return fork(workerPath, args, { execArgv: [], silent: true, env });
  }
  const { command, flags } = resolveNodeLaunch();
  return spawn(command, [...flags, workerPath, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
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
 * Fork the worker and replace the panel content with the fresh page. If a
 * render is already running, remember to run once more when it finishes
 * (collapsing any number of intermediate saves into one rebuild).
 */
function renderToPanel(extensionPath: string): void {
  if (!currentSource || !currentPanel) {
    return;
  }
  if (renderProcess) {
    renderQueued = true;
    return;
  }

  const workerPath = path.join(
    extensionPath,
    "out",
    "instant-preview-worker.mjs",
  );
  const args = [
    currentSource.sourcePath,
    "--project-dir",
    currentSource.projectDir,
  ];
  if (currentSource.publicationPath) {
    args.push("--publication", currentSource.publicationPath);
  }

  utils.updateStatusBarItem(ptxSBItem, "building");
  const started = Date.now();
  let child: ChildProcess;
  try {
    child = launchWorker(workerPath, args, {
      ...process.env,
      PRETEXT_HTML_ASSETS: path.join(extensionPath, "assets", "pretext-html"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    utils.updateStatusBarItem(ptxSBItem, "ready");
    pretextOutputChannel.appendLine(`[Instant Preview] ${message}`);
    window.showErrorMessage(message);
    return;
  }
  renderProcess = child;

  const stdout: Buffer[] = [];
  child.stdout?.on("data", (data: Buffer) => stdout.push(data));
  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) {
      pretextOutputChannel.appendLine(`[Instant Preview] ${text}`);
    }
  });

  let spawnFailed = false;
  child.on("error", (err) => {
    spawnFailed = true;
    renderProcess = undefined;
    utils.updateStatusBarItem(ptxSBItem, "ready");
    pretextOutputChannel.appendLine(`[Instant Preview] ${String(err)}`);
    window.showErrorMessage(
      "Instant preview could not start its Node.js worker. Check the PreTeXt output log.",
    );
  });

  child.on("close", (code) => {
    if (spawnFailed) {
      return;
    }
    renderProcess = undefined;
    if (code === 0 && currentPanel) {
      const html = Buffer.concat(stdout).toString("utf8");
      currentPanel.webview.html = prepareWebviewHtml(html);
      utils.updateStatusBarItem(ptxSBItem, "success");
      pretextOutputChannel.appendLine(
        `[Instant Preview] Rebuilt in ${Date.now() - started}ms`,
      );
    } else if (code !== 0) {
      utils.updateStatusBarItem(ptxSBItem, "ready");
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
    if (renderQueued) {
      renderQueued = false;
      renderToPanel(extensionPath);
    }
  });
}

/**
 * Adapt the standalone page for a VS Code webview: allow CDN assets through
 * a CSP meta tag and preserve the scroll position across content replacement
 * (replacing webview.html reloads the page).
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
  const scrollScript = [
    "<script>",
    "(function () {",
    "  const vscode = acquireVsCodeApi();",
    "  const prior = vscode.getState();",
    "  if (prior && typeof prior.scrollY === 'number') {",
    "    window.addEventListener('load', function () {",
    "      window.scrollTo(0, prior.scrollY);",
    "    });",
    "  }",
    "  let ticking = false;",
    "  window.addEventListener('scroll', function () {",
    "    if (ticking) { return; }",
    "    ticking = true;",
    "    setTimeout(function () {",
    "      vscode.setState({ scrollY: window.scrollY });",
    "      ticking = false;",
    "    }, 100);",
    "  });",
    "})();",
    "</script>",
  ].join("\n");

  return html
    .replace(/<head([^>]*)>/i, `<head$1>\n${cspTag}`)
    .replace(/<\/body>/i, `${scrollScript}\n</body>`);
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

/** Clean up watchers and any in-flight render. */
export function disposeInstantPreview(): void {
  saveWatcher?.dispose();
  saveWatcher = undefined;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  if (renderProcess && !renderProcess.killed) {
    renderProcess.kill();
  }
  renderProcess = undefined;
  renderQueued = false;
  currentSource = undefined;
}
