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
  TextEditor,
  TextEditorSelectionChangeKind,
  Uri,
  ViewColumn,
  Webview,
  WebviewPanel,
  commands,
  env,
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
  PREVIEW_THEME_MESSAGE,
  previewThemeMessage,
  type PreviewTheme,
} from "@pretextbook/pretext-html/theme";
import {
  ensureCliServer,
  runCliBuild,
  servedUrl,
  stopCliServer,
  type CliTarget,
} from "./cliPreviewServer";
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
/** The last .ptx/.xml editor to hold focus; see resolveSource. */
let lastActiveEditor: TextEditor | undefined;
let editorTracker: Disposable | undefined;
let followTimer: ReturnType<typeof setTimeout> | undefined;
let configWatcher: Disposable | undefined;
let viewStateWatcher: Disposable | undefined;
/** Set once the group-lock command has actually been issued for this panel. */
let groupLockAttempted = false;
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

/**
 * What the panel is currently showing.
 *
 * - "live": the XSLT-in-process render, which *is* the webview document (so it
 *   can be rewritten in place, keep its scroll, and sync with the editor).
 * - "full": an iframe onto the `pretext view` server, serving whatever the
 *   PreTeXt CLI last built. Editor sync does not apply — the page is
 *   cross-origin and carries no source map.
 */
type PreviewMode = "live" | "full";

let previewMode: PreviewMode = "live";
/** Guards against re-entrant mode switches while a server is starting. */
let switchingMode = false;
/** Serializes `pretext build` runs in full-build mode. */
let fullBuildInProgress = false;
/** A save landed since the build the panel is currently showing. */
let fullBuildStale = false;
let fullBuildTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Path within the served build that full-build mode last showed, as reported
 * by the bridge script. Lets a switch back to full build reopen on the page
 * the reader left, rather than the start page.
 */
let fullBuildPath: string | undefined;

const DEBOUNCE_MS = 400;
const SYNC_DEBOUNCE_MS = 150;
const MAX_CRASH_RETRIES = 2;
/** Height of the injected mode toolbar; the theme offsets below match it. */
const TOOLBAR_HEIGHT_PX = 32;
/** Quiet period after a save before full-build mode runs `pretext build`. */
const FULL_BUILD_DEBOUNCE_MS = 1000;
/** Quiet period before following the editor to a newly focused file. */
const FOLLOW_DEBOUNCE_MS = 300;

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
  /**
   * Name of the manifest's html target, when the project declares one. Only
   * full-build mode uses it — it is what gets passed to `pretext build`/`view`.
   */
  htmlTargetName?: string;
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
 * Lock the preview panel's editor group, once, so files opened elsewhere (a
 * double-click in the Targets tree view, "Go to Definition", etc.) do not land
 * in — and replace — the preview instead of opening beside it.
 *
 * `workbench.action.lockEditorGroup` is a workbench command with no group
 * argument in the stable API: it always acts on whichever group is currently
 * *active*. So this is gated on `currentPanel.active` — the one signal VS Code
 * itself gives for "this panel's group is the active one right now" — rather
 * than assumed from timing, since firing the command a moment too early would
 * lock the reader's source-editor group by mistake.
 *
 * `groupLockAttempted` makes the lock a one-time-only action: if the reader
 * manually unlocks the group later (the tab context menu offers this), that
 * choice is respected rather than re-clamped shut the next time the panel
 * regains focus.
 */
function lockPreviewGroupOnce(): void {
  if (groupLockAttempted || !currentPanel?.active) {
    return;
  }
  groupLockAttempted = true;
  void commands.executeCommand("workbench.action.lockEditorGroup");
}

/**
 * Reconcile the toolbar's follow checkbox when the setting is changed from
 * somewhere other than the toolbar (the Settings UI, another window, a
 * workspace file edit).
 */
function setupConfigWatcher(): void {
  configWatcher?.dispose();
  configWatcher = workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration(
        "pretext-tools.instantPreview.followActiveEditor",
      )
    ) {
      void currentPanel?.webview.postMessage({
        command: "follow",
        on: followActiveEditor(),
      });
    }
  });
}

/**
 * Whether the live preview re-renders when the reader switches source files.
 *
 * Only meaningful in "current-file" scope — the whole-project scope always
 * renders the main source file, so there is nothing to follow.
 */
function followActiveEditor(): boolean {
  return (
    workspace
      .getConfiguration("pretext-tools")
      .get<boolean>("instantPreview.followActiveEditor") ?? true
  );
}

/**
 * Track the last PreTeXt editor to hold focus — so the preview can still tell
 * what the reader is working on once focus moves into the panel itself — and,
 * when following is on, re-render as they move between files.
 *
 * The preview has always followed the editor on *save*; this just drops the
 * requirement to save first. Debounced because cycling through tabs (or a
 * "go to definition" that passes through several files) would otherwise queue
 * a render per file passed.
 */
function setupEditorTracker(extensionPath: string): void {
  editorTracker?.dispose();
  const active = window.activeTextEditor;
  if (active?.document.fileName.match(/\.(ptx|xml)$/)) {
    lastActiveEditor = active;
  }
  editorTracker = window.onDidChangeActiveTextEditor((editor) => {
    if (!editor?.document.fileName.match(/\.(ptx|xml)$/)) {
      return;
    }
    lastActiveEditor = editor;
    if (
      !currentPanel ||
      previewMode !== "live" ||
      previewScope() !== "current-file" ||
      !followActiveEditor()
    ) {
      return;
    }
    if (followTimer) {
      clearTimeout(followTimer);
    }
    followTimer = setTimeout(() => {
      followTimer = undefined;
      const next = resolveSource();
      // Nothing to do when the newly focused file resolves to what is already
      // on screen — notably project.ptx and publication files, which are not
      // renderable content and leave the preview on its current source.
      if (
        !next ||
        (currentSource &&
          fileKey(next.activePath) === fileKey(currentSource.activePath))
      ) {
        return;
      }
      currentSource = next;
      renderToPanel(extensionPath);
    }, FOLLOW_DEBOUNCE_MS);
  });
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
    groupLockAttempted = false;
    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
      disposeInstantPreview();
    });
    // Covers the (likely) case where the panel is already active by the time
    // this line runs; onDidChangeViewState below covers the rest.
    lockPreviewGroupOnce();
    viewStateWatcher = currentPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        lockPreviewGroupOnce();
      }
    });
    // Reverse sync: the webview's bootstrap posts the ancestor id chain of a
    // double-clicked element; resolve it against the source map.
    panelMessageWatcher = currentPanel.webview.onDidReceiveMessage(
      (message: unknown) => {
        const msg = message as {
          command?: unknown;
          ids?: unknown;
          mode?: unknown;
          path?: unknown;
          follow?: unknown;
        };
        switch (msg?.command) {
          case "revealSource":
            if (Array.isArray(msg.ids)) {
              void revealSource(msg.ids.filter((x) => typeof x === "string"));
            }
            return;
          case "setMode":
            if (msg.mode === "live" || msg.mode === "full") {
              void setPreviewMode(msg.mode, extensionPath);
            }
            return;
          case "rebuild":
            void rebuildFullBuild();
            return;
          case "framePath":
            if (typeof msg.path === "string") {
              fullBuildPath = msg.path;
            }
            return;
          case "setFollow":
            if (typeof msg.follow === "boolean") {
              void workspace
                .getConfiguration("pretext-tools")
                .update(
                  "instantPreview.followActiveEditor",
                  msg.follow,
                  workspace.workspaceFolders
                    ? ConfigurationTarget.Workspace
                    : ConfigurationTarget.Global,
                );
            }
            return;
          case "openExternal": {
            const target = fullBuildTarget();
            const url = target && servedUrl(target);
            if (url) {
              void env.openExternal(Uri.parse(url));
            }
            return;
          }
        }
      },
    );
    setupSaveWatcher(extensionPath);
    setupSelectionWatcher();
    setupThemeWatcher();
    setupEditorTracker(extensionPath);
    setupConfigWatcher();
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
  // Falling back to the tracked editor matters whenever the webview holds
  // focus — clicking the mode toolbar, for one — because that leaves
  // activeTextEditor undefined even though the reader plainly means "the file
  // I was just editing".
  const active = window.activeTextEditor;
  const editor = active?.document.fileName.match(/\.(ptx|xml)$/)
    ? active
    : lastActiveEditor;
  if (!editor) {
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
  let htmlTargetName: string | undefined;
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
      htmlTargetName = htmlTarget?.$?.name;
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
  return {
    activePath,
    mainSourcePath,
    projectDir,
    publicationPath,
    htmlTargetName,
  };
}

/** The build full-build mode should serve, when the project declares one. */
function fullBuildTarget(): CliTarget | undefined {
  if (!currentSource?.htmlTargetName) {
    return undefined;
  }
  return {
    projectDir: currentSource.projectDir,
    target: currentSource.htmlTargetName,
  };
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
  if (!currentSource || !currentPanel || previewMode !== "live") {
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
  if (previewMode !== "live") {
    // The user switched to the full build while this render was in flight;
    // applying it now would tear down the page they asked for. The source map
    // is still worth keeping for when they switch back.
    applySourceMap(message.sourceMap);
    utils.updateStatusBarItem(ptxSBItem, "ready");
    return;
  }
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

/** Update the toolbar's status text in place, without re-rendering. */
function postStatus(text: string): void {
  void currentPanel?.webview.postMessage({ command: "status", text });
}

/**
 * Switch what the panel shows.
 *
 * Going to full-build mode can take a while (it starts — and on a cold project
 * first runs — the PreTeXt CLI), so the current page stays up, reporting
 * progress through the toolbar's status text, until there is a URL to show. If
 * it fails we stay in live mode: a panel still showing a working preview is a
 * better outcome than an empty one plus an error.
 */
async function setPreviewMode(
  mode: PreviewMode,
  extensionPath: string,
): Promise<void> {
  if (mode === previewMode || switchingMode || !currentPanel) {
    return;
  }

  if (mode === "live") {
    previewMode = "live";
    // Catch up with wherever the reader has moved since full-build mode took
    // over — the editor may well be on a different file by now.
    currentSource = resolveSource() ?? currentSource;
    // Force the next delivery through webview.html rather than an in-place
    // rewrite. Beyond being a genuinely different document, this gives it a
    // fresh CSP list — see previewCsp on why writing a second policy into a
    // live document is a one-way ratchet.
    panelHasContent = false;
    renderToPanel(extensionPath);
    return;
  }

  const target = fullBuildTarget();
  if (!target) {
    window.showErrorMessage(
      "Full-build mode needs an html target in the project's project.ptx, " +
        "and none was found. The live preview does not need one.",
    );
    return;
  }

  switchingMode = true;
  utils.updateStatusBarItem(ptxSBItem, "building");
  postStatus(`Starting the PreTeXt server for "${target.target}"…`);
  try {
    const url = await ensureCliServer(target);
    if (!currentPanel) {
      return; // panel closed while the server was starting
    }
    previewMode = "full";
    // As above: a real reload, not an in-place rewrite.
    panelHasContent = false;
    updatePanelContent(
      fullBuildWrapperHtml(currentPanel.webview, url, target.target),
    );
    utils.updateStatusBarItem(ptxSBItem, "success");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pretextOutputChannel.appendLine(`[Full Build] ${message}`);
    utils.updateStatusBarItem(ptxSBItem, "ready");
    postStatus("Full build unavailable — staying on the live preview.");
    window.showErrorMessage(message, "Show Log").then((choice) => {
      if (choice === "Show Log") {
        pretextOutputChannel.show();
      }
    });
  } finally {
    switchingMode = false;
  }
}

/**
 * Toolbar "Rebuild", and the endpoint of the debounced auto-rebuild: run
 * `pretext build`, then reload the served page.
 *
 * Serialized by fullBuildInProgress, since two concurrent `pretext build`
 * runs would write the same output directory. A save that arrives mid-build
 * is not lost — it sets fullBuildStale, and the rebuild is re-armed on the way
 * out so the page ends up reflecting the newest source.
 */
async function rebuildFullBuild(): Promise<void> {
  const target = fullBuildTarget();
  if (!target || previewMode !== "full" || fullBuildInProgress) {
    return;
  }
  fullBuildInProgress = true;
  fullBuildStale = false;
  utils.updateStatusBarItem(ptxSBItem, "building");
  postStatus(`Building "${target.target}"…`);
  try {
    const built = await runCliBuild(target);
    utils.updateStatusBarItem(ptxSBItem, built ? "success" : "ready");
    if (built) {
      postStatus(target.target);
      void currentPanel?.webview.postMessage({ command: "reloadFrame" });
    } else {
      postStatus("Build failed — see the PreTeXt output log.");
      window
        .showErrorMessage(
          `\`pretext build ${target.target}\` produced no HTML output.`,
          "Show Log",
        )
        .then((choice) => {
          if (choice === "Show Log") {
            pretextOutputChannel.show();
          }
        });
    }
  } finally {
    fullBuildInProgress = false;
    if (fullBuildStale && previewMode === "full") {
      // Source changed while that build was running — catch up.
      scheduleFullBuild();
    }
  }
}

/** Arm (or re-arm) the debounced auto-rebuild. */
function scheduleFullBuild(): void {
  if (fullBuildTimer) {
    clearTimeout(fullBuildTimer);
  }
  fullBuildTimer = setTimeout(() => {
    fullBuildTimer = undefined;
    if (previewMode !== "full") {
      return;
    }
    if (fullBuildInProgress) {
      // rebuildFullBuild re-arms us from its finally block.
      fullBuildStale = true;
      return;
    }
    void rebuildFullBuild();
  }, FULL_BUILD_DEBOUNCE_MS);
}

/**
 * Called when a .ptx/.xml file is saved while the panel is showing the full
 * build, instead of the live re-render that would otherwise happen.
 *
 * The toolbar says so immediately — a CLI build is slow enough that the page
 * would otherwise sit there silently lying about what the source contains —
 * and a rebuild follows on a debounce, so a burst of saves costs one build
 * rather than one per save.
 */
function onSourceSavedWhileFullBuild(): void {
  const target = fullBuildTarget();
  if (!target) {
    return;
  }
  fullBuildStale = true;
  if (!fullBuildInProgress) {
    postStatus(`${target.target} — source changed, rebuilding…`);
  }
  scheduleFullBuild();
}

/**
 * The Content-Security-Policy meta tag for *both* modes' pages — deliberately
 * one policy, not one per page.
 *
 * `document.open()` does not clear a document's CSP list (that would be a
 * trivial bypass), so a page written in place by updatePanelContent *adds* its
 * meta policy to the list already there, and the browser enforces the
 * intersection of all of them. Two different policies therefore ratchet each
 * other down permanently: a wrapper that omitted `https:` from `style-src`
 * would silently strip the CDN stylesheets from every live render afterwards,
 * for the life of the webview. Keeping one policy for every document we write
 * makes that composition a no-op.
 *
 * `frame-src` accordingly has to cover both the asymptote 3d output embedded
 * by rendered pages and the `pretext view` server behind full-build mode,
 * whose port is not known when the first live page is built.
 */
function previewCsp(webview: Webview): string {
  return [
    "default-src 'none'",
    // cspSource covers the rewritten project assets; https:/data: the CDN.
    `img-src ${webview.cspSource} https: data:`,
    `media-src ${webview.cspSource} https:`,
    "script-src https: 'unsafe-inline' 'unsafe-eval'",
    "style-src https: 'unsafe-inline'",
    "font-src https: data:",
    "connect-src https:",
    // asymptote emits 3d output as an <iframe> into the generated directory;
    // the localhost sources are full-build mode's CLI server.
    `frame-src ${webview.cspSource} https: http://localhost:* http://127.0.0.1:*`,
  ].join("; ");
}

function cspMetaTag(webview: Webview): string {
  return `<meta http-equiv="Content-Security-Policy" content="${previewCsp(webview)}">`;
}

/**
 * Styles for the mode toolbar, shared by both modes' pages.
 *
 * The palette is hard-coded rather than taken from `--vscode-*` custom
 * properties: VS Code injects those into the document it serves, and the live
 * preview replaces the whole document on every rebuild (see
 * updatePanelContent), which drops them. Instead the dark palette keys off the
 * `dark-mode` class that pretext-html's theme bridge toggles on <html>, so the
 * toolbar re-themes itself whenever the preview does — including on the live
 * theme updates posted by setupThemeWatcher, with no re-render.
 */
function toolbarCss(): string {
  return [
    "<style>",
    `:root { --ptx-tools-h: ${TOOLBAR_HEIGHT_PX}px; }`,
    "#ptx-tools-bar {",
    "  --ptx-tools-bg: #f3f3f3; --ptx-tools-fg: #3b3b3b;",
    "  --ptx-tools-border: #cecece; --ptx-tools-btn: #e9e9e9;",
    "  --ptx-tools-btn-hover: #dcdcdc; --ptx-tools-on: #0066b8;",
    "  --ptx-tools-on-fg: #ffffff;",
    // Positioning is left to each page: live mode pins it over the rendered
    // document, the full-build wrapper puts it in flow above the iframe.
    "  box-sizing: border-box; height: var(--ptx-tools-h);",
    "  z-index: 2147483000;",
    "  display: flex; align-items: center; gap: 6px;",
    "  padding: 0 8px; box-sizing: border-box;",
    "  font: 12px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI',",
    "    system-ui, sans-serif;",
    "  background: var(--ptx-tools-bg); color: var(--ptx-tools-fg);",
    "  border-bottom: 1px solid var(--ptx-tools-border);",
    "  -webkit-user-select: none; user-select: none;",
    "}",
    "html.dark-mode #ptx-tools-bar {",
    "  --ptx-tools-bg: #252526; --ptx-tools-fg: #cccccc;",
    "  --ptx-tools-border: #3c3c3c; --ptx-tools-btn: #3a3d41;",
    "  --ptx-tools-btn-hover: #45494e; --ptx-tools-on: #0e639c;",
    "  --ptx-tools-on-fg: #ffffff;",
    "}",
    "#ptx-tools-bar button {",
    "  font: inherit; color: inherit; background: var(--ptx-tools-btn);",
    "  border: 1px solid var(--ptx-tools-border); border-radius: 4px;",
    "  padding: 3px 10px; cursor: pointer; white-space: nowrap;",
    "}",
    "#ptx-tools-bar button:hover { background: var(--ptx-tools-btn-hover); }",
    "#ptx-tools-bar .ptx-tools-seg { display: flex; }",
    "#ptx-tools-bar .ptx-tools-seg button {",
    "  border-radius: 0; margin: 0;",
    "}",
    "#ptx-tools-bar .ptx-tools-seg button:first-child {",
    "  border-radius: 4px 0 0 4px;",
    "}",
    "#ptx-tools-bar .ptx-tools-seg button:last-child {",
    "  border-radius: 0 4px 4px 0; border-left-width: 0;",
    "}",
    "#ptx-tools-bar button[aria-pressed='true'] {",
    "  background: var(--ptx-tools-on); color: var(--ptx-tools-on-fg);",
    "  border-color: var(--ptx-tools-on);",
    "}",
    "#ptx-tools-status {",
    "  opacity: 0.75; margin-left: 2px; min-width: 0;",
    "  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
    "}",
    "#ptx-tools-bar .ptx-tools-spacer { margin-left: auto; }",
    "#ptx-tools-bar[data-mode='live'] .ptx-tools-full-only { display: none; }",
    "#ptx-tools-bar[data-mode='full'] .ptx-tools-live-only { display: none; }",
    "#ptx-tools-bar[data-scope='project'] .ptx-tools-file-only {",
    "  display: none;",
    "}",
    "</style>",
  ].join("\n");
}

/**
 * Push the rendered page down so the fixed toolbar does not cover it.
 *
 * `#ptx-navbar` is `position: sticky; top: 0` in the PreTeXt theme, so body
 * padding alone would leave it sliding under the toolbar once scrolled; it
 * needs the matching offset. Only used by live mode — the full-build page is
 * an iframe we lay out ourselves. This couples to two long-standing element
 * ids ([pretext-html.xsl] `ptx-navbar`, `ptx-sidebar`); if a future theme
 * renames them the worst case is a cosmetic overlap, not a broken preview.
 */
function toolbarLayoutCss(): string {
  return [
    "<style>",
    "#ptx-tools-bar { position: fixed; top: 0; left: 0; right: 0; }",
    "body { padding-top: var(--ptx-tools-h) !important; }",
    "</style>",
  ].join("\n");
}

/** The toolbar markup for a given mode. `status` is the initial hint text. */
function toolbarHtml(mode: PreviewMode, status: string): string {
  const pressed = (which: PreviewMode) => (which === mode ? "true" : "false");
  // data-scope drives whether the follow toggle is shown at all: in project
  // scope the preview always renders the main source file, so following the
  // editor would do nothing and offering it would just be a lie.
  return [
    `<div id="ptx-tools-bar" data-mode="${mode}" data-scope="${previewScope()}">`,
    '  <div class="ptx-tools-seg" role="group" aria-label="Preview mode">',
    '    <button type="button" data-ptx-mode="live"',
    `      aria-pressed="${pressed("live")}"`,
    '      title="Fast, partial render of current source file with two-way sync  (updates on save).">',
    "      Division preview</button>",
    '    <button type="button" data-ptx-mode="full"',
    `      aria-pressed="${pressed("full")}"`,
    '      title="The full output of `pretext build`, served by the PreTeXt-CLI">',
    "      Full build</button>",
    "  </div>",
    `  <span id="ptx-tools-status">${escapeHtml(status)}</span>`,
    '  <span class="ptx-tools-spacer"></span>',
    '  <button type="button" class="ptx-tools-live-only ptx-tools-file-only"',
    '    data-ptx-action="toggleFollow"',
    `    aria-pressed="${followActiveEditor() ? "true" : "false"}"`,
    '    title="Re-render when you switch to another source file">',
    "    Follow editor</button>",
    '  <button type="button" class="ptx-tools-full-only" data-ptx-action="rebuild"',
    '    title="Run `pretext build` and reload">Rebuild</button>',
    '  <button type="button" class="ptx-tools-full-only"',
    '    data-ptx-action="openExternal"',
    '    title="Open this build in your browser">Browser</button>',
    "</div>",
  ].join("\n");
}

/** Escape text for interpolation into the toolbar markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Toolbar wiring, spliced into each page's bootstrap IIFE (so it can use the
 * `api` handle already established there). Re-runs after every in-place
 * document rewrite, hence the per-element `__ptxWired` guard.
 */
const TOOLBAR_SCRIPT_LINES: string[] = [
  "  var bar = document.getElementById('ptx-tools-bar');",
  "  if (bar && !bar.__ptxWired) {",
  "    bar.__ptxWired = true;",
  "    bar.addEventListener('click', function (event) {",
  "      var el = event.target;",
  "      var btn = el && el.closest ? el.closest('button') : null;",
  "      if (!btn) { return; }",
  "      var mode = btn.getAttribute('data-ptx-mode');",
  "      if (mode) {",
  "        api.postMessage({ command: 'setMode', mode: mode });",
  "        return;",
  "      }",
  "      var action = btn.getAttribute('data-ptx-action');",
  "      if (!action) { return; }",
  // Flip the checkbox here rather than waiting for the extension to persist
  // the setting and echo it back; the round trip is visible as lag on a
  // control that should feel instant. The 'follow' message below reconciles
  // if the setting is changed from anywhere else.
  "      if (action === 'toggleFollow') {",
  "        var on = btn.getAttribute('aria-pressed') !== 'true';",
  "        btn.setAttribute('aria-pressed', on ? 'true' : 'false');",
  "        api.postMessage({ command: 'setFollow', follow: on });",
  "        return;",
  "      }",
  "      api.postMessage({ command: action });",
  "    });",
  "  }",
];

/** The `status` message branch, spliced into each page's message handler. */
const TOOLBAR_STATUS_BRANCH: string[] = [
  "    if (msg.command === 'status') {",
  "      var statusEl = document.getElementById('ptx-tools-status');",
  "      if (statusEl) { statusEl.textContent = msg.text || ''; }",
  "      return;",
  "    }",
  // Keeps the checkbox honest when the setting is changed from the Settings
  // UI or another window, rather than from this toolbar.
  "    if (msg.command === 'follow') {",
  "      var followEl = document.querySelector(",
  "        '[data-ptx-action=\"toggleFollow\"]');",
  "      if (followEl) {",
  "        followEl.setAttribute('aria-pressed', msg.on ? 'true' : 'false');",
  "      }",
  "      return;",
  "    }",
];

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
  const cspTag = cspMetaTag(webview);
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
    ...TOOLBAR_STATUS_BRANCH,
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
    ...TOOLBAR_SCRIPT_LINES,
    // The navbar and ToC sidebar are pinned by the theme at offsets it
    // computes itself, so there is no fixed value to override in CSS — and
    // more importantly, whether they are pinned to the *top* at all depends on
    // the viewport: PreTeXt's narrow-screen layout parks the navigation at the
    // bottom. So measure what the theme actually decided and only add the
    // toolbar's height to things it put at the top. Clearing our own value
    // first makes this idempotent, which matters because it re-runs on resize
    // when the layout flips between the wide and narrow arrangements.
    `  var PTX_BAR_H = ${TOOLBAR_HEIGHT_PX};`,
    "  function ptxOffsetPinned() {",
    "    var ids = ['ptx-navbar', 'ptx-sidebar'];",
    "    for (var i = 0; i < ids.length; i++) {",
    "      var el = document.getElementById(ids[i]);",
    "      if (!el) { continue; }",
    "      el.style.removeProperty('top');",
    "      var cs = window.getComputedStyle(el);",
    "      if (cs.position !== 'sticky' && cs.position !== 'fixed') {",
    "        continue;",
    "      }",
    "      if (cs.top === 'auto') { continue; }",
    "      var base = parseFloat(cs.top);",
    "      if (isNaN(base)) { continue; }",
    "      // Bottom-anchored bars stay put even if they resolve a numeric top.",
    "      var rect = el.getBoundingClientRect();",
    "      if (rect.top > window.innerHeight / 2) { continue; }",
    "      // 'important' because the theme sets these with it too.",
    "      el.style.setProperty('top', (base + PTX_BAR_H) + 'px', 'important');",
    "    }",
    "  }",
    "  ptxOffsetPinned();",
    "  window.addEventListener('load', ptxOffsetPinned);",
    "  if (window.__ptxResizeHandler) {",
    "    window.removeEventListener('resize', window.__ptxResizeHandler);",
    "  }",
    "  window.__ptxResizeHandler = function () {",
    "    if (window.__ptxResizeTimer) {",
    "      clearTimeout(window.__ptxResizeTimer);",
    "    }",
    "    window.__ptxResizeTimer = setTimeout(ptxOffsetPinned, 100);",
    "  };",
    "  window.addEventListener('resize', window.__ptxResizeHandler);",
    "})();",
    "</script>",
  ].join("\n");

  const status =
    previewScope() === "project"
      ? "Whole project"
      : path.basename(currentSource?.activePath ?? "");

  return page
    .replace(
      /<head([^>]*)>/i,
      `<head$1>\n${cspTag}\n${toolbarCss()}\n${toolbarLayoutCss()}`,
    )
    .replace(/<body([^>]*)>/i, `<body$1>\n${toolbarHtml("live", status)}`)
    .replace(/<\/body>/i, `${bootstrapScript}\n</body>`);
}

/**
 * The page shown in full-build mode: the mode toolbar over an iframe onto the
 * `pretext view` server.
 *
 * Unlike the live page this is a wrapper we own end to end, so the toolbar is
 * a plain flex row rather than a fixed overlay with theme offsets. The served
 * build is cross-origin, so nothing inside the frame can be scripted from here
 * — no source map, no click-to-source, no scroll restore. Those are exactly
 * the affordances live mode exists to provide.
 */
function fullBuildWrapperHtml(
  webview: Webview,
  url: string,
  target: string,
): string {
  // Reopen where the reader left off, when the bridge has told us. `url` stays
  // the fallback the wrapper reloads to if this build carries no bridge.
  let initialUrl = url;
  if (fullBuildPath) {
    try {
      initialUrl = new URL(fullBuildPath, url).toString();
    } catch {
      initialUrl = url;
    }
  }
  // The theme bridge only ships inside rendered pages, so set the class the
  // toolbar's dark palette keys off directly.
  const rootClass =
    currentPreviewTheme() === "dark" ? ' class="dark-mode"' : "";
  return [
    "<!DOCTYPE html>",
    `<html lang="en"${rootClass}>`,
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    cspMetaTag(webview),
    "<title>PreTeXt Full Build</title>",
    toolbarCss(),
    "<style>",
    // A flex column in viewport units, rather than a percentage-height chain
    // plus an absolutely positioned frame: this cannot collapse to the
    // iframe's 300x150 intrinsic size if one rule fails to apply, and it does
    // not depend on the written document escaping quirks mode.
    "html, body { margin: 0; padding: 0; }",
    "body { height: 100vh; overflow: hidden;",
    "  display: flex; flex-direction: column; }",
    "html.dark-mode { background: #1e1e1e; }",
    "#ptx-tools-bar { position: static; flex: 0 0 auto; }",
    "#ptx-tools-frame {",
    "  flex: 1 1 auto; min-height: 0; width: 100%; border: 0;",
    "  background: #ffffff;",
    "}",
    "</style>",
    "</head>",
    "<body>",
    toolbarHtml("full", target),
    `<iframe id="ptx-tools-frame" src="${escapeHtml(initialUrl)}"></iframe>`,
    "<script>",
    "(function () {",
    "  var api = window.__ptxPreviewApi ||",
    "    (window.__ptxPreviewApi = acquireVsCodeApi());",
    "  var frame = document.getElementById('ptx-tools-frame');",
    `  var baseUrl = ${JSON.stringify(url)};`,
    "  var framePath = null;",
    "  if (window.__ptxUpdateHandler) {",
    "    window.removeEventListener('message', window.__ptxUpdateHandler);",
    "  }",
    "  window.__ptxUpdateHandler = function (event) {",
    "    var msg = event.data;",
    "    if (!msg) { return; }",
    // The wrapper carries no theme bridge (that ships inside rendered pages),
    // so it applies the editor's theme switches to its own root itself — this
    // is what keeps the toolbar's dark palette in step in full-build mode.
    `    if (msg.type === ${JSON.stringify(PREVIEW_THEME_MESSAGE)}) {`,
    "      var dark = msg.theme === 'dark' || (msg.theme === 'system' &&",
    "        !!(window.matchMedia &&",
    "          window.matchMedia('(prefers-color-scheme: dark)').matches));",
    "      document.documentElement.classList.toggle('dark-mode', dark);",
    "      return;",
    "    }",
    ...TOOLBAR_STATUS_BRANCH,
    // Each built page announces where it is (see FRAME_BRIDGE_SCRIPT); relay
    // that to the extension so it can reopen on the same page after a mode
    // switch, when this whole document is rebuilt from scratch.
    "    if (msg.command === 'ptxFramePath' && typeof msg.path === 'string') {",
    "      framePath = msg.path;",
    "      api.postMessage({ command: 'framePath', path: msg.path });",
    "      return;",
    "    }",
    "    if (msg.command === 'reloadFrame') {",
    "      if (framePath && frame.contentWindow) {",
    "        // Reload the page the reader is actually on. Having the page",
    "        // reload itself also lets the browser restore its scroll.",
    "        frame.contentWindow.postMessage(",
    "          { command: 'ptxFrameReload' }, '*');",
    "      } else {",
    "        // No bridge in this build (it predates us, or was unwritable):",
    "        // fall back to re-pointing the frame at the start page.",
    "        var sep = baseUrl.indexOf('?') === -1 ? '?' : '&';",
    "        frame.src = baseUrl + sep + '_ptx=' + Date.now();",
    "      }",
    "      return;",
    "    }",
    "    if (msg.command === 'update' && typeof msg.html === 'string') {",
    "      document.open();",
    "      document.write(msg.html);",
    "      document.close();",
    "    }",
    "  };",
    "  window.addEventListener('message', window.__ptxUpdateHandler);",
    ...TOOLBAR_SCRIPT_LINES,
    "})();",
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");
}

/** Rebuild on save of any .ptx/.xml file (debounced), unless disabled. */
function setupSaveWatcher(extensionPath: string): void {
  saveWatcher?.dispose();
  saveWatcher = workspace.onDidSaveTextDocument((document) => {
    if (!document.fileName.match(/\.(ptx|xml)$/) || !currentPanel) {
      return;
    }
    if (previewMode === "full") {
      onSourceSavedWhileFullBuild();
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
  if (previewMode !== "live") {
    return; // the full build is cross-origin and carries no source map
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
  editorTracker?.dispose();
  editorTracker = undefined;
  configWatcher?.dispose();
  configWatcher = undefined;
  viewStateWatcher?.dispose();
  viewStateWatcher = undefined;
  groupLockAttempted = false;
  if (followTimer) {
    clearTimeout(followTimer);
    followTimer = undefined;
  }
  lastActiveEditor = undefined;
  fullBuildPath = undefined;
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
  // The CLI server outlives our child process, so it needs an explicit stop.
  // Kept running while the panel is open (even in live mode) so toggling back
  // to the full build is instant.
  stopCliServer();
  if (fullBuildTimer) {
    clearTimeout(fullBuildTimer);
    fullBuildTimer = undefined;
  }
  previewMode = "live";
  switchingMode = false;
  fullBuildInProgress = false;
  fullBuildStale = false;
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
