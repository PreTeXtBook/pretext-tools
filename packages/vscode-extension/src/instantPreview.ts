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
 * The transform runs in a render worker the host provides (preview-host.ts):
 * a forked Node process on the desktop, where WebAssembly JSPI may need a
 * process-level flag (preview-host-node.ts); a Web Worker on github.dev /
 * vscode.dev (preview-host-browser.ts). Both answer the same render request
 * (preview-protocol.ts) with a standalone HTML page, which goes into a
 * WebviewPanel. Assets (theme css/js, MathJax) come from public CDNs, so the
 * preview needs network access but no local build artifacts.
 *
 * This module itself is host-neutral and ships in both bundles: it reads the
 * project through `workspace.fs`, and every path it handles is in the space
 * of virtual-path.ts (a real path for a `file:` document, a virtual one
 * otherwise) — `toUri` turns one back into a Uri; never `Uri.file`.
 */

import {
  ColorThemeKind,
  ConfigurationTarget,
  Disposable,
  FileType,
  Position,
  Range,
  RelativePattern,
  TextDocument,
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
// Aliased to path-browserify in the web bundle; only ever applied to the
// absolute paths of virtual-path.ts there.
import * as path from "path";
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
// Another dependency-free leaf subpath. Switching a deck between the scroll
// and presentation views only rewrites the config in HTML the worker already
// rendered, so it happens here rather than costing a round trip.
import {
  injectRevealBridge,
  type RevealView,
} from "@pretextbook/pretext-html/reveal";
// And another: entering or leaving the print-preview layout for a worksheet or
// handout only re-injects a bridge into HTML the worker already rendered, so it
// costs no round trip either. See @pretextbook/pretext-html/printout.
import {
  injectPrintPreview,
  type PrintoutInfo,
} from "@pretextbook/pretext-html/printout";
// And one more: the in-place patcher every live page carries, so a re-render
// replaces only the blocks that changed instead of reloading the page.
import { livePatchScript } from "@pretextbook/pretext-html/live-patch";
import {
  TOOLBAR_HEIGHT_PX,
  TOOLBAR_SCRIPT_LINES,
  TOOLBAR_STATUS_BRANCH,
  liveBootstrapScript,
} from "./preview-bootstrap";
import type {
  FullBuildTarget,
  PreviewHost,
  PreviewWorker,
} from "./preview-host";
import type {
  RenderRequest,
  RenderResponse,
  RenderedSubtree,
} from "./preview-protocol";
import { findProjectRoot, parentFolder } from "./project";
import { parseTargetsFromManifest } from "./project-manifest";
import { pathToUri, uriToPath } from "./virtual-path";
import {
  assetVersion,
  assetWatchGlob,
  isInsideAny,
  watchedAssetDirs,
  type PreviewAssetDirs,
} from "./preview-assets";
import {
  pretextOutputChannel,
  ptxSBItem,
  updateStatusBarItem,
} from "./ui-core";

let currentPanel: WebviewPanel | undefined;
let panelHasContent = false;
/**
 * The page the panel was last handed, exactly as delivered. The webview keeps
 * its own copy of each page it receives by message, to diff the next one
 * against, but a page loaded through webview.html arrives without one — so the
 * first update after such a load carries this along (see updatePanelContent).
 */
let deliveredHtml: string | undefined;
/** Whether the webview holds a copy of the page it is showing. */
let webviewHasPage = false;
/**
 * What the page on screen shows, when the next live render may be patched
 * into it rather than written over it (see patchableKey); undefined when it
 * may not be.
 */
let deliveredKey: string | undefined;
let saveWatcher: Disposable | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let typingWatcher: Disposable | undefined;
let typingTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * The editor state the last render request was made from, when that was the
 * open document for the rendered file. Saving a document that was already
 * rendered as typed would only re-render the same text.
 */
let lastRenderedVersion: { file: string; version: number } | undefined;
let currentSource: SourceInfo | undefined;

// Source map of the last successful render (see @pretextbook/pretext-html's
// sourcemap.ts): HTML element ids ↔ source file/line, powering two-way sync.
// Indexed by (normalized) file for cursor-follow and by id for click-to-source.
/**
 * The last page the worker produced, exactly as it produced it, so the panel
 * can be re-delivered without a re-render.
 *
 * Two controls need that: the slideshow view toggle (reveal reads its view once,
 * at initialize) and the print-preview layout (pretext-core.js applies it once,
 * on DOMContentLoaded, destructively). Both are properties of *this* HTML, and
 * both are re-injected from the pristine copy rather than from whatever is
 * currently in the panel — the injections replace their own earlier block, and
 * starting from untouched output keeps that simple.
 *
 * Undefined before the first successful live render, and again once the panel
 * closes.
 */
let lastRender:
  | {
      html: string;
      assetDirs?: PreviewAssetDirs;
      /** "slides" for a reveal.js deck; decides which controls apply. */
      target: "html" | "slides";
      /** The page's printouts, for the toolbar's print-preview menu. */
      printouts: PrintoutInfo[];
      /** The printout this document is *about*, when it is about one. */
      rootPrintout?: string;
      /** The file rendered, which the preview may have moved on from since. */
      renderPath: string;
      /** The one division shown, when not the whole document. */
      subtree?: RenderedSubtree;
    }
  | undefined;

/**
 * A division the reader picked from a summary page's links, to be shown by
 * the next render in place of the one around the cursor. Cleared by the next
 * cursor-driven render, so following the cursor resumes as soon as the
 * reader moves it.
 */
let pinnedDivision: string | undefined;
let divisionTimer: ReturnType<typeof setTimeout> | undefined;

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
/**
 * Watchers on the directories behind the page's asset URLs, the directories
 * they cover, and the pending refresh they schedule. See watchAssetDirs.
 */
let assetWatchers: Disposable[] = [];
let watchedAssetPaths: string[] = [];
let watchedAssetKey: string | undefined;
let assetRefreshTimer: ReturnType<typeof setTimeout> | undefined;

// The persistent render worker. Kept alive across renders so the loaded WASM
// module and compiled stylesheet (the ~600ms cold start) are reused; each
// subsequent render is just a ~100ms transform.
let worker: PreviewWorker | undefined;
/** The host the open panel runs on; set when it opens, cleared on dispose. */
let activeHost: PreviewHost | undefined;
let nextRequestId = 1;
// Id of the render we are currently waiting on (undefined when idle). Only one
// render is in flight at a time; the worker serializes internally too.
let pendingRequestId: number | undefined;
let pendingStarted = 0;
// The file the render in flight was asked for.
let pendingRenderPath = "";
// A newer render requested while one was in flight; collapses bursts of saves.
let renderQueued = false;
// Whether the render in flight, and every render collapsed into the queued
// one, was started by typing. A typed document is often briefly invalid, so
// such a render fails quietly (see handleRenderResponse).
let pendingFromTyping = false;
let queuedFromTyping = false;
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

/** What a render came to, for {@link previewTestHooks}. */
export type PreviewRenderOutcome =
  | { ok: true; html: string; elapsedMs: number }
  | { ok: false; error: string };

let renderWaiters: ((outcome: PreviewRenderOutcome) => void)[] = [];

function settleRenderWaiters(outcome: PreviewRenderOutcome): void {
  const waiters = renderWaiters;
  renderWaiters = [];
  waiters.forEach((resolve) => resolve(outcome));
}

/**
 * Observation points for the integration suites (both hosts' `activate`
 * return them); no part of the preview's own behaviour depends on them.
 */
export const previewTestHooks = {
  /**
   * The outcome of the next render to finish — or of the attempt to start
   * the render worker, when that is what fails.
   */
  nextRender(): Promise<PreviewRenderOutcome> {
    return new Promise((resolve) => renderWaiters.push(resolve));
  },
};

const DEBOUNCE_MS = 400;
/** Pause in typing before the preview renders the unsaved document. */
const TYPING_DEBOUNCE_MS = 300;
const SYNC_DEBOUNCE_MS = 150;
const MAX_CRASH_RETRIES = 2;
/** Quiet period after a save before full-build mode runs `pretext build`. */
const FULL_BUILD_DEBOUNCE_MS = 1000;
/** Quiet period before following the editor to a newly focused file. */
const FOLLOW_DEBOUNCE_MS = 300;
/**
 * How long the asset directories must be quiet before the page is refreshed.
 * `pretext generate` writes several files per image (svg, png, pdf, tex), so
 * one refresh at the end beats one per file.
 */
const ASSET_REFRESH_DEBOUNCE_MS = 400;
/**
 * Warning shown by the dismissible banner atop every preview (see
 * RenderOptions.previewBanner in @pretextbook/pretext-html). Worded for this
 * embedder specifically — pretext.plus renders the same fact in its own
 * "build settings" vocabulary rather than reusing this string.
 */
const PREVIEW_BANNER_MESSAGE =
  "This live preview does not use your project's publication file — your " +
  "built version may have different styles and options.";

interface SourceInfo {
  /**
   * The content file the preview follows (the last relevant .ptx in the
   * editor). Rendered directly — as a wrapped fragment when needed — in the
   * "file" and "division" scopes.
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

/**
 * How much the live preview shows:
 *
 * - "file": the active source file, whole.
 * - "division": the division around the cursor in the active source file —
 *   a division that contains divisions as a summary page, a leaf division in
 *   full — unless the document is small enough to show whole
 *   (`instantPreview.wholeDocumentUpTo`).
 * - "project": the project's main source file with every include, whole.
 *
 * The file and division scopes follow the active editor; the project scope
 * has nothing to follow.
 */
type PreviewScope = "file" | "division" | "project";

/** A path of the preview's path space (virtual-path.ts) back as a Uri. */
function toUri(absolutePath: string): Uri {
  return Uri.parse(pathToUri(absolutePath));
}

/** An editor document's path in that space (its fsPath for a `file:` one). */
function docPath(document: TextDocument): string {
  return uriToPath(document.uri.toString());
}

/** Whether a document is PreTeXt source the preview can follow. */
function isPretextDocument(document: TextDocument | undefined): boolean {
  return !!document && /\.(ptx|xml)$/.test(document.uri.path);
}

/** The first 4KB of a document: enough to see its root element. */
function documentHead(document: TextDocument): string {
  return document.getText(
    new Range(new Position(0, 0), document.positionAt(4096)),
  );
}

async function fileExists(absolutePath: string): Promise<boolean> {
  return (await fileStat(absolutePath)) !== undefined;
}

/** A file's stat, or undefined when it is missing or not a file. */
async function fileStat(
  absolutePath: string,
): Promise<{ mtimeMs: number; size: number } | undefined> {
  try {
    const stat = await workspace.fs.stat(toUri(absolutePath));
    if (!(stat.type & FileType.File)) {
      return undefined;
    }
    return { mtimeMs: stat.mtime, size: stat.size };
  } catch {
    return undefined;
  }
}

/** Whether the toolbar can offer a full `pretext build` on this host. */
function fullBuildAvailable(): boolean {
  return activeHost?.fullBuild !== undefined;
}

function previewScope(): PreviewScope {
  const scope = workspace
    .getConfiguration("pretext-tools")
    .get<string>("instantPreview.scope", "division");
  switch (scope) {
    case "file":
    case "project":
      return scope;
    default:
      // Including "current-file", the setting's former name for following the
      // active file, which the division scope now does.
      return "division";
  }
}

/** Whether the preview follows the active editor rather than the main file. */
function followsActiveFile(): boolean {
  return previewScope() !== "project";
}

/**
 * The file the live preview renders right now: the active one, or the project's
 * main file in whole-project scope. Undefined before there is a source at all.
 */
function currentRenderPath(): string | undefined {
  if (!currentSource) {
    return undefined;
  }
  return previewScope() === "project"
    ? (currentSource.mainSourcePath ?? currentSource.activePath)
    : currentSource.activePath;
}

/**
 * The PreTeXt HTML theme (denver, tacoma, …) the preview should fall back on.
 *
 * Only reaches the build for projects whose publication file names no theme of
 * its own — the renderer treats it as a default, never an override, so a book
 * that has picked a theme still previews in it. Empty means "no opinion",
 * leaving PreTeXt's own default-modern in place.
 */
function previewCssTheme(): string | undefined {
  const theme = workspace
    .getConfiguration("pretext-tools")
    .get<string>("instantPreview.cssTheme")
    ?.trim();
  return theme || undefined;
}

/**
 * How a slideshow preview opens: "scroll" for the whole deck as one
 * continuous page, "slides" for reveal.js's ordinary presentation.
 *
 * The setting is only the *starting* view; the toolbar toggle overrides it for
 * the session (see {@link revealViewOverride}).
 */
function configuredRevealView(): RevealView {
  return workspace
    .getConfiguration("pretext-tools")
    .get<string>("instantPreview.slidesView") === "slides"
    ? "slides"
    : "scroll";
}

/**
 * The view the user last toggled to, which outranks the setting until the
 * panel closes. Cleared on dispose so a new panel starts from the setting
 * again.
 */
let revealViewOverride: RevealView | undefined;

/** The view a slideshow render should use right now. */
function currentRevealView(): RevealView {
  return revealViewOverride ?? configuredRevealView();
}

/**
 * Which printout the reader picked from the toolbar, if any:
 *
 * - `undefined` — no choice made; the document's own default applies, which
 *   means print preview for a file that *is* a worksheet or handout and the
 *   ordinary page for anything else.
 * - `null` — explicitly the ordinary page, outranking that default.
 * - a string — that printout, in the print-preview layout.
 *
 * A per-file choice, not a session-wide one: {@link renderToPanel} clears it
 * when the preview moves to another source file. Deciding to look at worksheet
 * 3 on paper says nothing about the chapter opened next, and a choice that
 * outlived its file would either strand the reader in a layout they asked for
 * once or suppress the default on a worksheet they went on to open.
 */
let printoutChoice: string | null | undefined;

/** The file {@link printoutChoice} was made about; see there. */
let printoutChoicePath: string | undefined;

/**
 * The printout the panel should be showing right now — the reader's choice
 * when they made one and it still exists on the page, the document's own
 * default otherwise, and undefined for the ordinary layout.
 *
 * Validated against the page rather than trusted, because the same choice
 * survives every rebuild of the file it was made about: rename the worksheet's
 * `xml:id`, or delete it mid-edit, and the id it names is simply gone. Falling
 * back to the default beats asking pretext-core.js for a printout that is not
 * there (which strands the page in print styling with nothing on it).
 */
function currentPrintout(): string | undefined {
  const printouts = lastRender?.printouts ?? [];
  if (printoutChoice === null) {
    return undefined;
  }
  if (
    printoutChoice !== undefined &&
    printouts.some((printout) => printout.id === printoutChoice)
  ) {
    return printoutChoice;
  }
  return lastRender?.rootPrintout;
}

/**
 * How much of the preview's width a slide fills in the scroll view.
 *
 * Clamped rather than trusted: this comes straight from user settings, and a
 * value at or past the ends would render a deck either invisibly small or with
 * no room to lay out in at all.
 */
function previewSlidesZoom(): number {
  const zoom = workspace
    .getConfiguration("pretext-tools")
    .get<number>("instantPreview.slidesZoom");
  if (typeof zoom !== "number" || !isFinite(zoom)) {
    return ZOOM_MAX;
  }
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * The reveal.js theme decks fall back on when their publication file names
 * none.
 *
 * "auto" (the default) follows the editor, because a deck cannot: reveal pages
 * load none of the PreTeXt javascript behind light/dark mode, so unlike an
 * ordinary preview there is no runtime switch to post at — the choice has to
 * be baked in at render time. "simple" and "black" are reveal's own minimal
 * light and dark themes, the closest match to how the HTML preview looks.
 */
function previewRevealTheme(): string | undefined {
  const setting = workspace
    .getConfiguration("pretext-tools")
    .get<string>("instantPreview.slidesTheme")
    ?.trim();
  if (!setting || setting === "auto") {
    return currentPreviewTheme() === "dark" ? "black" : "simple";
  }
  return setting;
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
 * React to settings the open panel reflects: reconcile the toolbar's follow
 * checkbox when it is changed from somewhere other than the toolbar (the
 * Settings UI, another window, a workspace file edit), and re-render when the
 * css theme changes, since that is baked into the publication file the
 * transform reads.
 */
function setupConfigWatcher(host: PreviewHost): void {
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
    if (event.affectsConfiguration("pretext-tools.instantPreview.cssTheme")) {
      renderToPanel(host);
    }
    // The reveal theme is baked into the publication file, so it genuinely
    // needs the document rebuilding; the view and zoom only change what reveal
    // is initialized with, so re-injecting is enough — and is what the toolbar
    // buttons have already done by the time this fires for their own writes.
    if (
      event.affectsConfiguration("pretext-tools.instantPreview.slidesTheme")
    ) {
      renderToPanel(host);
    } else if (
      event.affectsConfiguration("pretext-tools.instantPreview.slidesZoom") ||
      event.affectsConfiguration("pretext-tools.instantPreview.slidesView")
    ) {
      if (
        event.affectsConfiguration("pretext-tools.instantPreview.slidesView")
      ) {
        // Deliberately changing the setting outranks a toolbar toggle from
        // earlier in the session; otherwise the setting would appear to do
        // nothing until the panel was reopened.
        revealViewOverride = undefined;
      }
      if (isSlideshowPreview()) {
        void redeliverPreview({ fresh: true });
      }
    }
  });
}

/**
 * Whether the live preview re-renders when the reader switches source files.
 *
 * Only meaningful in the file and division scopes — the project scope always
 * renders the main source file, so there is nothing to follow.
 */
function followActiveEditor(): boolean {
  return (
    workspace
      .getConfiguration("pretext-tools")
      .get<boolean>("instantPreview.followActiveEditor") ?? true
  );
}

/** Whether the live preview renders the unsaved document as you type. */
function updateWhileTyping(): boolean {
  return (
    workspace
      .getConfiguration("pretext-tools")
      .get<boolean>("instantPreview.updateWhileTyping") ?? false
  );
}

/**
 * Documents of at most this many elements are previewed whole; larger ones
 * show only the division around the cursor (see RenderOptions.subtree).
 */
function wholeDocumentUpTo(): number {
  const limit = workspace
    .getConfiguration("pretext-tools")
    .get<number>("instantPreview.wholeDocumentUpTo");
  return typeof limit === "number" && limit >= 0 ? limit : 1000;
}

/** Whether `file` belongs to the project being previewed. */
function isProjectFile(file: string): boolean {
  if (!currentSource || !file.match(/\.(ptx|xml)$/)) {
    return false;
  }
  const relative = path.relative(currentSource.projectDir, file);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Where the reader is, for choosing the division to preview: the cursor in
 * the last focused editor when that editor is on the rendered file, else the
 * top of that file, which shows the file's own division (a chapter file as a
 * summary of its sections, a section file whole).
 */
function cursorSelection(renderPath: string): { file: string; line: number } {
  const editor = lastActiveEditor;
  const file = editor ? docPath(editor.document) : undefined;
  if (editor && file && fileKey(file) === fileKey(renderPath)) {
    return { file, line: editor.selection.active.line + 1 };
  }
  return { file: renderPath, line: 1 };
}

/**
 * Unsaved buffers of the project's other open files, so the division's
 * context — the main file, sibling includes — is what the editor shows and
 * not what the disk last saw. The rendered file travels as sourceContent.
 */
function dirtyProjectFiles(renderPath: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const document of workspace.textDocuments) {
    const file = docPath(document);
    if (
      document.isDirty &&
      isProjectFile(file) &&
      fileKey(file) !== fileKey(renderPath)
    ) {
      files[file] = document.getText();
    }
  }
  return files;
}

/**
 * Whether a cursor at `line` of `file` has left the division on screen —
 * out of it, or into one of the divisions a summary page only lists — so
 * that the preview should move to the division around it.
 */
function cursorLeftRenderedDivision(file: string, line: number): boolean {
  const subtree = lastRender?.subtree;
  if (!subtree || !sourceMapById || previewScope() !== "division") {
    return false;
  }
  if (fileKey(file) !== fileKey(lastRender?.renderPath ?? "")) {
    return false;
  }
  const contains = (id: string): boolean => {
    const entry = sourceMapById?.get(id);
    return (
      !!entry &&
      fileKey(entry.file) === fileKey(file) &&
      entry.line <= line &&
      line <= entry.endLine
    );
  };
  if (!contains(subtree.id)) {
    return true;
  }
  return subtree.children.some(contains);
}

/** The toolbar's resting status text: what the live preview is rendering. */
function liveStatusText(): string {
  return previewScope() === "project"
    ? "Whole project"
    : path.basename(currentSource?.activePath ?? "");
}

/**
 * Identifies what the last rendered page shows, for deciding whether the next
 * render may be patched into the page on screen (see @pretextbook/pretext-html's
 * live-patch). Only a re-render of the same file is a candidate — anything
 * else is a different page, and a scroll position carried over from it would
 * mean nothing. Undefined for pages that must always load from scratch: a
 * slideshow (reveal.js lays out the deck once, at initialize) and the
 * print-preview layout (which pretext-core.js builds destructively, once, on
 * load).
 */
function patchableKey(): string | undefined {
  if (!lastRender || lastRender.target !== "html" || currentPrintout()) {
    return undefined;
  }
  return `${previewScope()}\n${fileKey(lastRender.renderPath)}`;
}

/**
 * Re-render as the reader types, when that is turned on: after a short pause,
 * from the unsaved documents (see renderToPanel). Edits to the file being
 * rendered count; in project scope, so does an edit anywhere in the project,
 * since every open file's buffer reaches the render.
 */
function setupTypingWatcher(host: PreviewHost): void {
  typingWatcher?.dispose();
  typingWatcher = workspace.onDidChangeTextDocument((event) => {
    if (
      !currentPanel ||
      previewMode !== "live" ||
      event.contentChanges.length === 0 ||
      !updateWhileTyping()
    ) {
      return;
    }
    const renderPath = currentRenderPath();
    if (!renderPath) {
      return;
    }
    const counts =
      previewScope() === "project"
        ? isProjectFile(docPath(event.document))
        : fileKey(docPath(event.document)) === fileKey(renderPath);
    if (!counts) {
      return;
    }
    if (typingTimer) {
      clearTimeout(typingTimer);
    }
    typingTimer = setTimeout(() => {
      typingTimer = undefined;
      renderToPanel(host, { fromTyping: true });
    }, TYPING_DEBOUNCE_MS);
  });
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
function setupEditorTracker(host: PreviewHost): void {
  editorTracker?.dispose();
  const active = window.activeTextEditor;
  if (isPretextDocument(active?.document)) {
    lastActiveEditor = active;
  }
  editorTracker = window.onDidChangeActiveTextEditor((editor) => {
    if (!editor || !isPretextDocument(editor.document)) {
      return;
    }
    lastActiveEditor = editor;
    if (
      !currentPanel ||
      previewMode !== "live" ||
      !followsActiveFile() ||
      !followActiveEditor()
    ) {
      return;
    }
    if (followTimer) {
      clearTimeout(followTimer);
    }
    followTimer = setTimeout(async () => {
      followTimer = undefined;
      const next = await resolveSource();
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
      renderToPanel(host);
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
export async function cmdInstantPreview(host: PreviewHost): Promise<void> {
  activeHost = host;
  const source = await resolveSource();
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
        localResourceRoots: [toUri(source.projectDir)],
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
          id?: unknown;
          ok?: unknown;
          reason?: unknown;
          changed?: unknown;
        };
        switch (msg?.command) {
          case "patchResult":
            // How the page took the last render; see preview-bootstrap.ts.
            pretextOutputChannel.appendLine(
              msg.ok
                ? `[Instant Preview] Updated in place (${Number(msg.changed)} new or changed block(s))`
                : `[Instant Preview] Reloaded the page: ${String(msg.reason)}`,
            );
            return;
          case "revealSource":
            if (Array.isArray(msg.ids)) {
              void revealSource(msg.ids.filter((x) => typeof x === "string"));
            }
            return;
          case "showDivision":
            if (typeof msg.id === "string" && msg.id) {
              showDivision(msg.id);
            }
            return;
          case "setMode":
            if (
              msg.mode === "live" ||
              (msg.mode === "full" && fullBuildAvailable())
            ) {
              void setPreviewMode(msg.mode, host);
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
          case "setPrintout":
            // "" is the menu's "Off" entry: the ordinary page, deliberately.
            setPreviewPrintout(
              typeof msg.id === "string" && msg.id ? msg.id : undefined,
            );
            return;
          case "slidesScroll":
            setPreviewSlidesView("scroll");
            return;
          case "slidesPresent":
            setPreviewSlidesView("slides");
            return;
          case "zoomIn":
            cmdStepPreviewSlidesZoom(ZOOM_STEP);
            return;
          case "zoomOut":
            cmdStepPreviewSlidesZoom(-ZOOM_STEP);
            return;
          case "openExternal": {
            const target = fullBuildTarget();
            const url = target && activeHost?.fullBuild?.servedUrl(target);
            if (url) {
              void env.openExternal(Uri.parse(url));
            }
            return;
          }
        }
      },
    );
    setupSaveWatcher(host);
    setupTypingWatcher(host);
    setupSelectionWatcher();
    setupThemeWatcher();
    setupEditorTracker(host);
    setupConfigWatcher(host);
  } else {
    currentPanel.reveal(ViewColumn.Beside, true);
  }

  renderToPanel(host);
}

/**
 * Command handler: pick what the instant preview renders — the active source
 * file (wrapped as a standalone preview when it is a fragment) or the whole
 * project. Re-renders immediately when the preview panel is open.
 */
export async function cmdInstantPreviewScope(host: PreviewHost): Promise<void> {
  const current = previewScope();
  const picked = await window.showQuickPick(
    [
      {
        label: "Division at cursor",
        description:
          "Show the division around the cursor in the active file; a " +
          "chapter or book as a summary of the divisions inside it",
        scope: "division" as PreviewScope,
        picked: current === "division",
      },
      {
        label: "Current file",
        description: "Show the active source file in full",
        scope: "file" as PreviewScope,
        picked: current === "file",
      },
      {
        label: "Whole project",
        description:
          "Show the project's main source file with all includes, in full " +
          "— slow for a large book",
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
    currentSource = (await resolveSource()) ?? currentSource;
    renderToPanel(host);
  }
}

/** True when the page currently in the panel is a reveal.js deck. */
function isSlideshowPreview(): boolean {
  return lastRender?.target === "slides";
}

/**
 * Steps the toolbar's zoom buttons move by. Coarse enough that a click is
 * visibly worth making, fine enough to land on something comfortable in two or
 * three presses.
 */
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1;

/**
 * Zoom the deck in or out from the toolbar, and persist it.
 *
 * Written back to settings rather than kept as a session override — unlike the
 * view, which is a momentary "let me check how this looks", a comfortable zoom
 * is a lasting preference and re-picking it every session would be a chore.
 * The same reasoning the follow-editor toggle already uses.
 */
function cmdStepPreviewSlidesZoom(delta: number): void {
  const next = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.round((previewSlidesZoom() + delta) * 100) / 100),
  );
  if (next === previewSlidesZoom()) {
    return; // already at the end of the range; nothing to persist or redraw
  }
  // Only written here; the config watcher notices and re-delivers, so the
  // update has exactly one path whether it came from this button or from the
  // settings UI.
  void workspace
    .getConfiguration("pretext-tools")
    .update(
      "instantPreview.slidesZoom",
      next,
      workspace.workspaceFolders
        ? ConfigurationTarget.Workspace
        : ConfigurationTarget.Global,
    );
}

/**
 * Put the last rendered page back in the panel, with the view controls applied
 * as they now stand.
 *
 * Shared by the slideshow view toggle, the zoom stepper and the print-preview
 * menu: none of them changes the *document*, only how the page it produced
 * presents itself, so all three re-inject rather than re-render — instant even
 * on a book-sized deck. Always injects into the worker's untouched output, never
 * into the previously injected page: each injection replaces its own earlier
 * block, and starting from pristine HTML keeps that simple.
 *
 * `fresh` forces a new document via webview.html rather than the usual in-place
 * rewrite. Slideshows need it — reveal reads its view and slide size once, at
 * initialize — but the print-preview layout does not: pretext-core.js applies
 * that from a DOMContentLoaded handler, which a `document.write` fires just as a
 * reload does, and the in-place path keeps the CDN assets already loaded.
 */
async function redeliverPreview({ fresh = false } = {}): Promise<void> {
  if (!currentPanel || !lastRender) {
    return;
  }
  const html =
    lastRender.target === "slides"
      ? injectRevealBridge(lastRender.html, currentRevealView(), {
          zoom: previewSlidesZoom(),
        })
      : lastRender.html;
  const prepared = await prepareWebviewHtml(
    html,
    currentPanel.webview,
    currentSource?.projectDir ?? "",
    lastRender.assetDirs,
  );
  if (!currentPanel) {
    return; // closed meanwhile
  }
  if (fresh) {
    panelHasContent = false;
  }
  // Never patched: every caller is changing how the page presents itself, and
  // both the slideshow view and the print layout are set up only as a page
  // loads. The page it leaves behind may be patched into again, though.
  updatePanelContent(prepared);
  deliveredKey = patchableKey();
}

/**
 * Watch the directories behind the page's asset URLs, so the page shows a file
 * as soon as it changes on disk rather than after the next edit: a latex-image
 * regenerated by `pretext generate` or a background build, an external image
 * replaced, a missing one generated at last. See preview-assets.ts for why an
 * unchanged URL would otherwise keep showing the old picture.
 *
 * Called after every render. The watchers are only rebuilt when the
 * directories change (another project, or an edited publication file).
 */
function watchAssetDirs(
  assetDirs: PreviewAssetDirs | undefined,
  projectDir: string | undefined,
): void {
  const dirs =
    assetDirs && projectDir ? watchedAssetDirs(assetDirs, projectDir) : [];
  const key = projectDir ? [path.resolve(projectDir), ...dirs].join("\n") : "";
  if (key === watchedAssetKey) {
    return;
  }
  disposeAssetWatchers();
  watchedAssetKey = key;
  watchedAssetPaths = dirs;
  if (!projectDir) {
    return;
  }
  // Anchored at the project directory, so a directory that does not exist yet
  // is picked up when it is created; see assetWatchGlob.
  const base = toUri(path.resolve(projectDir));
  const onEvent = (uri: Uri) => {
    if (isInsideAny(uriToPath(uri.toString()), watchedAssetPaths)) {
      scheduleAssetRefresh();
    }
  };
  for (const glob of new Set(
    dirs.map((dir) => assetWatchGlob(projectDir, dir)),
  )) {
    const watcher = workspace.createFileSystemWatcher(
      new RelativePattern(base, glob),
    );
    assetWatchers.push(
      watcher,
      watcher.onDidCreate(onEvent),
      watcher.onDidChange(onEvent),
      watcher.onDidDelete(onEvent),
    );
  }
}

function disposeAssetWatchers(): void {
  for (const disposable of assetWatchers) {
    disposable.dispose();
  }
  assetWatchers = [];
  watchedAssetPaths = [];
  watchedAssetKey = undefined;
  if (assetRefreshTimer) {
    clearTimeout(assetRefreshTimer);
    assetRefreshTimer = undefined;
  }
}

function scheduleAssetRefresh(): void {
  if (assetRefreshTimer) {
    clearTimeout(assetRefreshTimer);
  }
  assetRefreshTimer = setTimeout(
    () => void refreshPreviewAssets(),
    ASSET_REFRESH_DEBOUNCE_MS,
  );
}

/**
 * Re-deliver the last rendered page with its asset URLs resolved afresh, so a
 * file that changed gets its new version in the URL (or, if it vanished, its
 * placeholder, and if it appeared, its image). No re-render: the document has
 * not changed, only files beside it.
 *
 * Patched into the page when it can be, which updates just the changed `src`
 * attributes in place, so the reader keeps their place and nothing else
 * reloads. Nothing is sent when no URL the page uses has changed, which is
 * the usual outcome of a build writing files the page does not show. Skipped
 * while a render is in flight, since its page will resolve the URLs afresh
 * when it arrives.
 */
async function refreshPreviewAssets(): Promise<void> {
  assetRefreshTimer = undefined;
  if (
    !currentPanel ||
    !lastRender?.assetDirs ||
    previewMode !== "live" ||
    !panelHasContent ||
    pendingRequestId !== undefined
  ) {
    return;
  }
  const html =
    lastRender.target === "slides"
      ? injectRevealBridge(lastRender.html, currentRevealView(), {
          zoom: previewSlidesZoom(),
        })
      : lastRender.html;
  const prepared = await prepareWebviewHtml(
    html,
    currentPanel.webview,
    currentSource?.projectDir ?? "",
    lastRender.assetDirs,
  );
  if (prepared === deliveredHtml || !currentPanel) {
    return;
  }
  const key = patchableKey();
  updatePanelContent(prepared, {
    patch: key !== undefined && key === deliveredKey,
  });
  deliveredKey = key;
  pretextOutputChannel.appendLine(
    "[Instant Preview] Asset files changed on disk; refreshed the images.",
  );
}

/**
 * Flip a slideshow preview between the scroll view and reveal.js's ordinary
 * presentation.
 *
 * No re-render: the two differ only in the config reveal.js is initialized
 * with, so the page the worker last produced is re-injected and re-delivered.
 * That costs a webview reload (a fresh document is the only way reveal picks
 * up a different view — see @pretextbook/pretext-html/reveal) but no XSLT, so
 * it is immediate even on a book-sized deck.
 *
 * The override lasts for the life of the panel rather than being written back
 * to settings: switching to presentation view to check how a slide will look
 * is a momentary thing, and a preference that silently rewrote itself every
 * time would be worse than one that did not.
 */
export function cmdTogglePreviewSlidesView(): void {
  if (!isSlideshowPreview()) {
    window.showInformationMessage(
      "The preview is not showing a slideshow. Open a PreTeXt slideshow " +
        "(a document whose top-level element is <slideshow>) to switch views.",
    );
    return;
  }
  setPreviewSlidesView(currentRevealView() === "scroll" ? "slides" : "scroll");
}

/** Show the deck in `view`, if it is not already. */
function setPreviewSlidesView(view: RevealView): void {
  if (!isSlideshowPreview() || view === currentRevealView()) {
    return;
  }
  revealViewOverride = view;
  void redeliverPreview({ fresh: true });
  pretextOutputChannel.appendLine(
    `[Instant Preview] Slideshow view: ${view === "scroll" ? "scrolling deck" : "presentation"}`,
  );
}

/**
 * Show one of the page's printouts in the print-preview layout — paginated to
 * a paper size, with each `<workspace>` at the height it will really have — or,
 * with no id, the ordinary page again.
 *
 * No re-render: the layout is applied by pretext-core.js from the HTML the
 * worker already produced (see @pretextbook/pretext-html/printout), so this
 * only re-delivers the page with the bridge set the other way.
 *
 * The choice is remembered for as long as the preview stays on this file, and
 * outranks the automatic default until then — including the "off" choice, so a
 * reader who leaves the print layout on a lone worksheet is not put straight
 * back into it by the next save.
 */
function setPreviewPrintout(id: string | undefined): void {
  // The menu is hidden in full-build mode, whose page is an iframe onto the
  // CLI server — re-delivering the live page over it would be a surprise.
  if (!lastRender || previewMode !== "live") {
    return;
  }
  printoutChoice = id ?? null;
  printoutChoicePath = currentRenderPath();
  void redeliverPreview();
  const printout = lastRender.printouts.find((entry) => entry.id === id);
  pretextOutputChannel.appendLine(
    `[Instant Preview] Print preview: ${printout ? printout.label : "off"}`,
  );
}

/**
 * Work out what to build: walk up from the active editor to a project.ptx,
 * then read main source and publication file out of the manifest (with the
 * pretext-cli defaults as fallback). The active file itself is kept as
 * `activePath` for current-file scope; the worker's --fragment mode makes
 * xi:included fragments renderable on their own.
 *
 * Reads through `workspace.fs`, so it works on a virtual workspace too; the
 * active document's own text comes from the editor rather than disk.
 */
async function resolveSource(): Promise<SourceInfo | undefined> {
  // Falling back to the tracked editor matters whenever the webview holds
  // focus — clicking the mode toolbar, for one — because that leaves
  // activeTextEditor undefined even though the reader plainly means "the file
  // I was just editing".
  const active = window.activeTextEditor;
  const editor = isPretextDocument(active?.document)
    ? active
    : lastActiveEditor;
  if (!editor) {
    return currentSource; // keep previewing the last known project
  }
  const document = editor.document;
  const filePath = docPath(document);
  // Manifest-ish files (project.ptx, publication files) are not renderable
  // content — keep following the previously active content file (their save
  // still triggers a rebuild through the save watcher).
  const head = documentHead(document);
  const activeRoot = rootElementOf(head);
  const isContent = activeRoot !== "project" && activeRoot !== "publication";

  const projectRoot = await findProjectRoot(parentFolder(document.uri));
  if (!projectRoot) {
    if (!isContent) {
      return currentSource;
    }
    return { activePath: filePath, projectDir: path.dirname(filePath) };
  }
  const projectDir = uriToPath(projectRoot.toString());

  let mainSourcePath: string | undefined;
  let publicationPath: string | undefined;
  let htmlTargetName: string | undefined;
  try {
    const manifest = new TextDecoder().decode(
      await workspace.fs.readFile(Uri.joinPath(projectRoot, "project.ptx")),
    );
    const targets = parseTargetsFromManifest(manifest, projectDir);
    // Prefer an html target's explicit source/publication. A target naming
    // no format is html by the CLI's default.
    const htmlTarget =
      targets.find((target) => target.format === "html") ??
      targets.find((target) => !target.format) ??
      targets[0];
    if (htmlTarget) {
      htmlTargetName = htmlTarget.name;
      mainSourcePath = htmlTarget.source;
      publicationPath = htmlTarget.publication;
    }
  } catch {
    // fall through to defaults below
  }

  if (!mainSourcePath || !(await fileExists(mainSourcePath))) {
    const fallback = path.join(projectDir, "source", "main.ptx");
    if (await fileExists(fallback)) {
      mainSourcePath = fallback;
    } else if (isContent && isCompleteDocument(head)) {
      mainSourcePath = filePath;
    } else {
      mainSourcePath = undefined;
    }
  }
  if (!publicationPath || !(await fileExists(publicationPath))) {
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
function fullBuildTarget(): FullBuildTarget | undefined {
  if (!currentSource?.htmlTargetName) {
    return undefined;
  }
  return {
    projectDir: currentSource.projectDir,
    target: currentSource.htmlTargetName,
  };
}

/**
 * Name of the root element of an XML document, given its head (see
 * documentHead), or undefined when there is none in it. A prolog comment
 * longer than the head gives undefined, which callers treat conservatively.
 */
function rootElementOf(head: string): string | undefined {
  // Strip the prolog (xml declaration, PIs, comments, doctype) and look at
  // the first real element.
  const prolog = head
    .replace(/<\?[\s\S]*?\?>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!DOCTYPE[^>]*>/gi, " ");
  return prolog.match(/<\s*([A-Za-z][\w:-]*)/)?.[1];
}

/**
 * True when the document is a complete PreTeXt document (<pretext> or legacy
 * <mathbook> root element) rather than an xi:included fragment.
 */
function isCompleteDocument(head: string): boolean {
  const root = rootElementOf(head);
  return root === "pretext" || root === "mathbook";
}

/**
 * Return the live render worker, launching it (in persistent serve mode) if
 * needed and wiring its message/exit handlers exactly once. Returns undefined
 * if the worker could not be started (an error is surfaced to the user).
 */
function ensureWorker(host: PreviewHost): PreviewWorker | undefined {
  if (worker) {
    return worker;
  }
  let child: PreviewWorker;
  try {
    child = host.launchWorker();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateStatusBarItem(ptxSBItem, "ready");
    pretextOutputChannel.appendLine(`[Instant Preview] ${message}`);
    window.showErrorMessage(message);
    settleRenderWaiters({ ok: false, error: message });
    return undefined;
  }

  child.onLog((line) =>
    pretextOutputChannel.appendLine(`[Instant Preview] ${line}`),
  );
  child.onMessage((message) => void handleWorkerMessage(message));
  child.onExit(({ description, failedToStart }) => {
    if (worker === child) {
      worker = undefined;
    }
    if (disposing) {
      return;
    }
    if (failedToStart) {
      pendingRequestId = undefined;
      renderQueued = false;
      updateStatusBarItem(ptxSBItem, "ready");
      window.showErrorMessage(description);
      settleRenderWaiters({ ok: false, error: description });
      return;
    }
    // Unexpected death (crash, OOM). If it took a render down with it, retry a
    // bounded number of times; otherwise the next render simply relaunches.
    pretextOutputChannel.appendLine(
      `[Instant Preview] Worker exited unexpectedly (${description}).`,
    );
    const wasRendering = pendingRequestId !== undefined;
    pendingRequestId = undefined;
    if ((wasRendering || renderQueued) && crashRetries < MAX_CRASH_RETRIES) {
      crashRetries += 1;
      renderQueued = false;
      pretextOutputChannel.appendLine(
        `[Instant Preview] Restarting worker (attempt ${crashRetries}).`,
      );
      if (activeHost) {
        renderToPanel(activeHost);
      }
    } else if (wasRendering || renderQueued) {
      renderQueued = false;
      updateStatusBarItem(ptxSBItem, "ready");
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
async function handleWorkerMessage(message: RenderResponse): Promise<void> {
  if (message.id !== pendingRequestId) {
    // Stale response from a superseded/relaunched render — ignore.
    return;
  }
  pendingRequestId = undefined;
  await handleRenderResponse(message);
  if (renderQueued && activeHost) {
    renderQueued = false;
    renderToPanel(activeHost, { fromTyping: queuedFromTyping });
  }
}

/**
 * Send a render request to the persistent worker. If one is already in flight,
 * remember to run once more when it finishes (collapsing a burst of saves into
 * a single rebuild).
 */
function renderToPanel(
  host: PreviewHost,
  { fromTyping = false }: { fromTyping?: boolean } = {},
): void {
  if (!currentSource || !currentPanel || previewMode !== "live") {
    return;
  }
  if (pendingRequestId !== undefined) {
    queuedFromTyping = renderQueued
      ? queuedFromTyping && fromTyping
      : fromTyping;
    renderQueued = true;
    return;
  }

  const child = ensureWorker(host);
  if (!child) {
    return;
  }

  const scope = previewScope();
  const renderPath = currentRenderPath() ?? currentSource.activePath;

  // A printout picked from the toolbar belongs to the file it was picked on;
  // moving the preview elsewhere hands the new page back to its own default.
  if (printoutChoicePath !== renderPath) {
    printoutChoice = undefined;
    printoutChoicePath = undefined;
  }

  currentPanel.title =
    scope === "project"
      ? "PreTeXt Preview: project"
      : `PreTeXt Preview: ${path.basename(renderPath)}`;

  updateStatusBarItem(ptxSBItem, "building");
  pretextOutputChannel.appendLine(
    `[Instant Preview] Rendering ${renderPath} (scope: ${scope})` +
      (currentSource.publicationPath
        ? ` (publication: ${path.basename(currentSource.publicationPath)})`
        : ""),
  );

  // Rendering as you type means rendering what is in the editor, saved or
  // not. Only the rendered file itself: the worker reads everything else it
  // needs (included files, the main file's docinfo) from the project.
  let sourceContent: string | undefined;
  lastRenderedVersion = undefined;
  if (updateWhileTyping()) {
    const open = workspace.textDocuments.find(
      (doc) => fileKey(docPath(doc)) === fileKey(renderPath),
    );
    if (open) {
      sourceContent = open.isDirty ? open.getText() : undefined;
      lastRenderedVersion = {
        file: fileKey(docPath(open)),
        version: open.version,
      };
    }
  }

  const id = nextRequestId++;
  pendingRequestId = id;
  pendingStarted = Date.now();
  pendingFromTyping = fromTyping;
  pendingRenderPath = renderPath;
  // --fragment behaviour: a lone chapter/section renders as a wrapped preview
  // document; complete documents are unaffected.
  const request: RenderRequest = {
    id,
    type: "render" as const,
    sourcePath: renderPath,
    sourceContent,
    projectDir: currentSource.projectDir,
    publicationPath: currentSource.publicationPath,
    // Only used for projects that declare no theme themselves; see
    // previewCssTheme.
    cssTheme: previewCssTheme(),
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
    // Render a fragment where it really sits in the book, so it is numbered
    // ("Theorem 3.2.1", not "Theorem 1.1") and its cross-references out of the
    // file resolve instead of showing PreTeXt's missing-target placeholder.
    // Supersedes docinfoSourcePath above when it takes effect; falls back to
    // the standalone wrapper when the fragment's @xml:id is not in the main
    // document, so a brand new file still previews.
    contextSourcePath: currentSource.mainSourcePath,
    // id ↔ file/line map for two-way sync; costs a few ms per render.
    sourceMap: true,
    // In division scope, only the division around the cursor — or the one
    // picked from a summary page — unless the document is small enough to
    // show whole. A division that contains divisions is a summary page: its
    // own content, then links to the divisions inside it; only leaf
    // divisions render in full. The other scopes render the file whole.
    ...(scope === "division"
      ? {
          subtree: {
            ...(pinnedDivision
              ? { id: pinnedDivision }
              : cursorSelection(renderPath)),
            wholeDocumentUpTo: wholeDocumentUpTo(),
          },
        }
      : {}),
    // The other open files' unsaved text, so the structure around the
    // division is the editor's, not the disk's.
    ...(updateWhileTyping() ? { files: dirtyProjectFiles(renderPath) } : {}),
    // Bake the editor's current theme into the page so it opens matching VS
    // Code (no light-then-dark flash). setupThemeWatcher posts live updates
    // for subsequent theme switches without a re-render.
    theme: currentPreviewTheme(),
    // Slideshow-only; ignored outright when the document is not a deck.
    revealView: currentRevealView(),
    revealTheme: previewRevealTheme(),
    revealZoom: previewSlidesZoom(),
    previewBanner: { message: PREVIEW_BANNER_MESSAGE },
  };
  child.send(request);
}

/** Apply a worker render response to the panel and status bar. */
async function handleRenderResponse(message: RenderResponse): Promise<void> {
  try {
    await applyRenderResponse(message);
  } finally {
    settleRenderWaiters(
      message.ok
        ? { ok: true, html: message.html, elapsedMs: message.elapsedMs }
        : { ok: false, error: message.error },
    );
  }
}

async function applyRenderResponse(message: RenderResponse): Promise<void> {
  if (previewMode !== "live") {
    // The user switched to the full build while this render was in flight;
    // applying it now would tear down the page they asked for. The source map
    // is still worth keeping for when they switch back.
    if (message.ok) {
      applySourceMap(message.sourceMap);
    }
    updateStatusBarItem(ptxSBItem, "ready");
    return;
  }
  if (message.ok && currentPanel) {
    const html = message.html;
    if (!html.includes("</html>")) {
      // Defensive: never blank the panel on incomplete output.
      updateStatusBarItem(ptxSBItem, "ready");
      pretextOutputChannel.appendLine(
        `[Instant Preview] Worker returned incomplete HTML ` +
          `(${html.length} bytes); keeping previous preview.`,
      );
      return;
    }
    crashRetries = 0;
    applySourceMap(message.sourceMap);
    // Kept so the view controls can be applied without a re-render: both the
    // slideshow view and the print-preview layout are properties of this exact
    // HTML, not of the document behind it.
    lastRender = {
      html,
      assetDirs: message.assetDirs,
      target: message.target === "slides" ? "slides" : "html",
      printouts: message.printouts ?? [],
      rootPrintout: message.rootPrintout,
      renderPath: pendingRenderPath,
      subtree: message.subtree,
    };
    if (message.subtree) {
      pretextOutputChannel.appendLine(
        `[Instant Preview] Showing division "${message.subtree.id}"` +
          (message.subtree.collapsed
            ? ` as a summary of ${message.subtree.children.length} division(s)`
            : ""),
      );
    }
    void commands.executeCommand(
      "setContext",
      "pretext-tools.previewIsSlideshow",
      message.target === "slides",
    );
    // A re-render of the page already on screen is patched into it, which
    // keeps the reader's place and only re-typesets what changed; the page
    // itself falls back to rewriting when a patch cannot be applied.
    const key = patchableKey();
    const prepared = await prepareWebviewHtml(
      html,
      currentPanel.webview,
      currentSource?.projectDir ?? "",
      message.assetDirs,
    );
    if (!currentPanel) {
      return; // closed while the asset files were being looked up
    }
    updatePanelContent(prepared, {
      patch: key !== undefined && key === deliveredKey,
    });
    deliveredKey = key;
    // The page's images change on disk independently of the source (a
    // background build regenerating them, say), so watch where they live.
    watchAssetDirs(message.assetDirs, currentSource?.projectDir);
    // A patch leaves the toolbar as it was, so clear anything a failed render
    // or mode switch left in the status text.
    postStatus(liveStatusText());
    updateStatusBarItem(ptxSBItem, "success");
    pretextOutputChannel.appendLine(
      `[Instant Preview] Rebuilt in ${message.elapsedMs ?? Date.now() - pendingStarted}ms`,
    );
    return;
  }

  updateStatusBarItem(ptxSBItem, "ready");
  if (!message.ok) {
    pretextOutputChannel.appendLine(`[Instant Preview] ${message.error}`);
  }
  if (pendingFromTyping) {
    // Mid-edit the document is often not well-formed yet; a popup for every
    // pause in typing would be unbearable. Keep the last good page up and say
    // so where the reader is already looking.
    postStatus(
      `${liveStatusText()} — source has errors; showing the last good preview`,
    );
    return;
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
 * whose bootstrap script either patches it into the page on screen (`patch`,
 * see prepareWebviewHtml) or rewrites the document in place
 * (document.open/write/close). Replacing webview.html on every rebuild forces
 * a full webview reload, which VS Code sometimes never completes — the panel
 * just goes blank — and also refetches all CDN assets and loses scroll.
 *
 * A patch is computed against the previous page's HTML, which the webview
 * keeps from each update message. A page loaded through webview.html has no
 * such copy, so the first update after one sends the previous page along.
 */
function updatePanelContent(
  preparedHtml: string,
  { patch = false }: { patch?: boolean } = {},
): void {
  const panel = currentPanel;
  if (!panel) {
    return;
  }
  const previous = deliveredHtml;
  deliveredHtml = preparedHtml;
  if (!panelHasContent) {
    panel.webview.html = preparedHtml;
    panelHasContent = true;
    webviewHasPage = false;
    return;
  }
  const message = {
    command: "update",
    html: preparedHtml,
    patch,
    previous: patch && !webviewHasPage ? previous : undefined,
  };
  webviewHasPage = true;
  Promise.resolve(panel.webview.postMessage(message)).then((delivered) => {
    if (!delivered && currentPanel === panel) {
      // Webview not live (should not happen with retainContextWhenHidden,
      // but don't drop the render on the floor).
      panel.webview.html = preparedHtml;
      webviewHasPage = false;
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
  host: PreviewHost,
): Promise<void> {
  if (mode === previewMode || switchingMode || !currentPanel) {
    return;
  }

  if (mode === "live") {
    previewMode = "live";
    // Catch up with wherever the reader has moved since full-build mode took
    // over — the editor may well be on a different file by now.
    currentSource = (await resolveSource()) ?? currentSource;
    // Force the next delivery through webview.html rather than an in-place
    // rewrite. Beyond being a genuinely different document, this gives it a
    // fresh CSP list — see previewCsp on why writing a second policy into a
    // live document is a one-way ratchet.
    panelHasContent = false;
    renderToPanel(host);
    return;
  }

  const bridge = host.fullBuild;
  const target = fullBuildTarget();
  if (!bridge) {
    return; // no PreTeXt CLI on this host; the toolbar does not offer it
  }
  if (!target) {
    window.showErrorMessage(
      "Full-build mode needs an html target in the project's project.ptx, " +
        "and none was found. The live preview does not need one.",
    );
    return;
  }

  switchingMode = true;
  updateStatusBarItem(ptxSBItem, "building");
  postStatus(`Starting the PreTeXt server for "${target.target}"…`);
  try {
    const url = await bridge.ensureServer(target);
    if (!currentPanel) {
      return; // panel closed while the server was starting
    }
    previewMode = "full";
    // As above: a real reload, not an in-place rewrite.
    panelHasContent = false;
    deliveredKey = undefined;
    updatePanelContent(
      fullBuildWrapperHtml(currentPanel.webview, url, target.target),
    );
    updateStatusBarItem(ptxSBItem, "success");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pretextOutputChannel.appendLine(`[Full Build] ${message}`);
    updateStatusBarItem(ptxSBItem, "ready");
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
  const bridge = activeHost?.fullBuild;
  const target = fullBuildTarget();
  if (!bridge || !target || previewMode !== "full" || fullBuildInProgress) {
    return;
  }
  fullBuildInProgress = true;
  fullBuildStale = false;
  updateStatusBarItem(ptxSBItem, "building");
  postStatus(`Building "${target.target}"…`);
  try {
    const built = await bridge.build(target);
    updateStatusBarItem(ptxSBItem, built ? "success" : "ready");
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
    // Slideshow controls appear only when the page in the panel is a deck, and
    // the zoom stepper only in the scrolling view — there is nothing to zoom
    // when a single slide is filling the pane.
    "#ptx-tools-bar:not([data-slides='yes']) .ptx-tools-slides-only {",
    "  display: none;",
    "}",
    "#ptx-tools-bar[data-slides-view='slides'] .ptx-tools-zoom {",
    "  display: none;",
    "}",
    "#ptx-tools-bar .ptx-tools-zoom {",
    "  display: flex; align-items: center; gap: 2px;",
    "}",
    // Fixed width so stepping the zoom does not shuffle the buttons sideways.
    "#ptx-tools-zoom-value {",
    "  opacity: 0.75; min-width: 3.2em; text-align: center;",
    "  font-variant-numeric: tabular-nums;",
    "}",
    // The print-preview menu, shown only for a page that has printouts.
    "#ptx-tools-bar:not([data-printouts='yes']) .ptx-tools-printout {",
    "  display: none;",
    "}",
    "#ptx-tools-bar .ptx-tools-printout {",
    "  display: flex; align-items: center; gap: 4px;",
    "}",
    "#ptx-tools-bar .ptx-tools-printout label { opacity: 0.75; }",
    "#ptx-tools-bar select {",
    "  font: inherit; color: inherit; background: var(--ptx-tools-btn);",
    "  border: 1px solid var(--ptx-tools-border); border-radius: 4px;",
    "  padding: 2px 4px; cursor: pointer; max-width: 22em;",
    "}",
    // A printout being previewed is a printout on its way to a printer, and
    // the toolbar has no business on the paper. The layout offset goes with it
    // — see toolbarLayoutCss, which sets it.
    "@media print {",
    "  #ptx-tools-bar { display: none !important; }",
    "  body { padding-top: 0 !important; }",
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

/**
 * The print-preview menu: which of the page's printouts is laid out for paper,
 * or none of them.
 *
 * One control for both cases the reader meets — a file that *is* a worksheet
 * (one entry, already selected, so the menu just says what is being shown and
 * how to leave it) and a chapter with several in it (pick one). Rendered as a
 * `<select>` because the page it belongs to is replaced wholesale on every
 * delivery, so the selected option *is* the state; there is nothing to keep in
 * sync.
 */
function printoutMenuHtml(): string {
  const printouts = lastRender?.printouts ?? [];
  const selected = currentPrintout();
  const option = (value: string, label: string) =>
    `    <option value="${escapeHtml(value)}"` +
    `${value === (selected ?? "") ? " selected" : ""}>` +
    `${escapeHtml(label)}</option>`;
  return [
    '  <span class="ptx-tools-printout ptx-tools-live-only">',
    '    <label for="ptx-tools-printout-select">Print preview</label>',
    '    <select id="ptx-tools-printout-select"',
    '      title="Show a worksheet or handout as it will print: paginated to a' +
      ' paper size, with room to write in every workspace">',
    option("", "Off"),
    ...printouts.map((printout) => option(printout.id, printout.label)),
    "    </select>",
    "  </span>",
  ].join("\n");
}

/** The toolbar markup for a given mode. `status` is the initial hint text. */
function toolbarHtml(mode: PreviewMode, status: string): string {
  const pressed = (which: PreviewMode) => (which === mode ? "true" : "false");
  // data-scope drives whether the follow toggle is shown at all: in project
  // scope the preview always renders the main source file, so following the
  // editor would do nothing and offering it would just be a lie.
  const slides = isSlideshowPreview();
  const view = currentRevealView();
  const zoomPercent = Math.round(previewSlidesZoom() * 100);
  // Likewise the print-preview menu, which is only shown for a page that has
  // printouts on it — and only there is there anything to drive it with, since
  // PreTeXt emits the paper-size and print-options controls for such pages
  // alone.
  const printouts = (lastRender?.printouts ?? []).length > 0;
  // The mode switch only where there is a PreTeXt CLI to build with; on the
  // web host the live render is the only mode, and a one-button switch would
  // just be noise.
  const modeSwitch = fullBuildAvailable()
    ? [
        '  <div class="ptx-tools-seg" role="group" aria-label="Preview mode">',
        '    <button type="button" data-ptx-mode="live"',
        `      aria-pressed="${pressed("live")}"`,
        '      title="Fast, partial render of current source file with two-way sync' +
          ` (updates ${updateWhileTyping() ? "as you type" : "on save"}).">`,
        "      Division preview</button>",
        '    <button type="button" data-ptx-mode="full"',
        `      aria-pressed="${pressed("full")}"`,
        '      title="The full output of `pretext build`, served by the PreTeXt-CLI">',
        "      Full build</button>",
        "  </div>",
      ]
    : [];
  const fullBuildButtons = fullBuildAvailable()
    ? [
        '  <button type="button" class="ptx-tools-full-only" data-ptx-action="rebuild"',
        '    title="Run `pretext build` and reload">Rebuild</button>',
        '  <button type="button" class="ptx-tools-full-only"',
        '    data-ptx-action="openExternal"',
        '    title="Open this build in your browser">Browser</button>',
      ]
    : [];
  return [
    `<div id="ptx-tools-bar" data-mode="${mode}" data-scope="${previewScope()}"` +
      ` data-slides="${slides ? "yes" : "no"}" data-slides-view="${view}"` +
      ` data-printouts="${printouts ? "yes" : "no"}">`,
    ...modeSwitch,
    `  <span id="ptx-tools-status">${escapeHtml(status)}</span>`,
    '  <span class="ptx-tools-spacer"></span>',
    '  <span class="ptx-tools-zoom ptx-tools-slides-only ptx-tools-live-only">',
    '    <button type="button" data-ptx-action="zoomOut"',
    '      title="Zoom out: smaller text, so more of each slide is visible">&#8722;</button>',
    `    <span id="ptx-tools-zoom-value">${zoomPercent}%</span>`,
    '    <button type="button" data-ptx-action="zoomIn"',
    '      title="Zoom in, up to the deck\'s true presented size">+</button>',
    "  </span>",
    '  <div class="ptx-tools-seg ptx-tools-slides-only ptx-tools-live-only"',
    '    role="group" aria-label="Slideshow view">',
    '    <button type="button" data-ptx-action="slidesScroll"',
    `      aria-pressed="${view === "scroll" ? "true" : "false"}"`,
    '      title="Show the whole deck as one scrolling page">',
    "      Deck</button>",
    '    <button type="button" data-ptx-action="slidesPresent"',
    `      aria-pressed="${view === "slides" ? "true" : "false"}"`,
    '      title="Show one slide at a time, with pauses, as it will be presented">',
    "      Present</button>",
    "  </div>",
    printoutMenuHtml(),
    '  <button type="button" class="ptx-tools-live-only ptx-tools-file-only"',
    '    data-ptx-action="toggleFollow"',
    `    aria-pressed="${followActiveEditor() ? "true" : "false"}"`,
    '    title="Re-render when you switch to another source file">',
    "    Follow editor</button>",
    ...fullBuildButtons,
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
 * Point the page's `external/` and `generated/` asset URLs at files on disk.
 *
 * Every image the page shows — author-supplied images and media, and every
 * generated asset including latex-image and PreFigure SVGs — is a relative URL
 * into an output directory the preview never creates. Rewriting them to
 * webview URIs lets the panel load the real files — lazily, and without
 * re-sending image bytes through postMessage on every rebuild the way data:
 * URIs or inlined SVG would.
 *
 * Each URI carries the file's version as its query, so a file that changes on
 * disk gets a new URL and the page fetches it again (see preview-assets.ts).
 * The webview ignores the query when it reads the file, and strips it before
 * checking localResourceRoots.
 *
 * The files are looked up through `workspace.fs`, which is asynchronous
 * while the rewriter is not: a first pass over the page collects what it
 * asks for, the stats come back together, and the resolver returned here
 * answers from them. One stat per asset per rebuild, as before.
 */
async function assetUriResolver(
  webview: Webview,
  assetDirs: PreviewAssetDirs,
  projectDir: string,
  html: string,
): Promise<AssetUrlResolver> {
  const root = path.resolve(projectDir);
  // Where an asset the page asks for would be, when it is in bounds.
  // Containment: a "../" in an @source must not turn into a webview URI for
  // an arbitrary file. localResourceRoots would refuse it anyway; failing
  // here keeps the page honest about what it asked for.
  const locate = (dir: string, relPath: string): string | undefined => {
    const filePath = path.resolve(dir, relPath);
    return filePath === root || filePath.startsWith(root + path.sep)
      ? filePath
      : undefined;
  };
  const wanted = new Set<string>();
  rewriteAssetUrls(html, (kind, relPath) => {
    const dir = assetDirs[kind];
    const filePath = dir === undefined ? undefined : locate(dir, relPath);
    if (filePath !== undefined) {
      wanted.add(filePath);
    }
    return undefined;
  });
  const stats = new Map<string, { mtimeMs: number; size: number }>();
  await Promise.all(
    [...wanted].map(async (filePath) => {
      const stat = await fileStat(filePath);
      if (stat) {
        stats.set(filePath, stat);
      }
    }),
  );
  return (kind, relPath) => {
    const dir = assetDirs[kind];
    // No external directory declared: PreTeXt reads that as "no external
    // assets", so an `external/` URL here names a file that a real build would
    // not have either. The placeholder's advice (check the external directory)
    // is exactly the fix.
    if (dir === undefined) {
      return missingAssetPlaceholder(kind, relPath);
    }
    const filePath = locate(dir, relPath);
    if (filePath === undefined) {
      return undefined;
    }
    // A project whose images have never been built is the normal case here,
    // not an error: `pretext generate` is a separate Python-side step this
    // preview exists to avoid needing. Substituting a placeholder that names
    // the missing asset beats the browser's broken-image glyph, which reads
    // as "the preview is broken".
    const stat = stats.get(filePath);
    if (!stat) {
      return missingAssetPlaceholder(kind, relPath);
    }
    return webview
      .asWebviewUri(toUri(filePath))
      .with({ query: assetVersion(stat) })
      .toString();
  };
}

/**
 * Adapt the standalone page for a VS Code webview: retarget project assets at
 * real files, put it in the print-preview layout when that is what the reader
 * asked for, allow CDN assets through a CSP meta tag, and add a bootstrap
 * script that (a) preserves the scroll position across rebuilds and (b)
 * applies "update" messages from the extension — by patching the changed
 * blocks into the page on screen when the message allows it and the patcher
 * can, and otherwise by rewriting the document in place (see
 * updatePanelContent).
 *
 * The print-preview state is applied *here*, on the way to the panel, rather
 * than beside the toolbar action that changes it — because every delivery has
 * to state it. A rebuild while the reader is looking at a worksheet on paper
 * must come back on paper, and the in-place rewrite that delivers it reuses the
 * same Window, where a bridge from the previous page is still installed: a page
 * that said nothing would inherit that stale answer rather than its own.
 */
async function prepareWebviewHtml(
  html: string,
  webview: Webview,
  projectDir: string,
  assetDirs?: PreviewAssetDirs,
): Promise<string> {
  const retargeted = assetDirs
    ? rewriteAssetUrls(
        html,
        await assetUriResolver(webview, assetDirs, projectDir, html),
      )
    : html;
  const page = injectPrintPreview(retargeted, currentPrintout());
  const cspTag = cspMetaTag(webview);
  const bootstrapScript = liveBootstrapScript();

  // Replacer functions rather than strings: a replacement string gives `$&`,
  // `$'` and friends special meaning, and the patcher is script source.
  return page
    .replace(
      /<head([^>]*)>/i,
      (_match, attrs: string) =>
        `<head${attrs}>\n${cspTag}\n${toolbarCss()}\n${toolbarLayoutCss()}`,
    )
    .replace(
      /<body([^>]*)>/i,
      (_match, attrs: string) =>
        `<body${attrs}>\n${toolbarHtml("live", liveStatusText())}`,
    )
    .replace(
      /<\/body>/i,
      () => `${livePatchScript()}\n${bootstrapScript}\n</body>`,
    );
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
function setupSaveWatcher(host: PreviewHost): void {
  saveWatcher?.dispose();
  saveWatcher = workspace.onDidSaveTextDocument((document) => {
    if (!isPretextDocument(document) || !currentPanel) {
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
    // Rendering as you type usually got here first: either it already
    // rendered exactly this text, or a render it is about to start will read
    // the file just saved along with everything else.
    if (
      typingTimer !== undefined ||
      (lastRenderedVersion?.file === fileKey(docPath(document)) &&
        lastRenderedVersion.version === document.version)
    ) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(async () => {
      // Re-resolve in case the user switched projects since opening the panel
      currentSource = (await resolveSource()) ?? currentSource;
      renderToPanel(host);
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
  return CASE_INSENSITIVE_PATHS ? normalized.toLowerCase() : normalized;
}

/** Windows compares paths case-insensitively; `process` is absent on the web. */
const CASE_INSENSITIVE_PATHS =
  typeof process !== "undefined" && process.platform === "win32";

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
    if (!isPretextDocument(event.textEditor.document)) {
      return;
    }
    const fileName = docPath(event.textEditor.document);
    const line = (event.selections[0]?.active.line ?? 0) + 1;
    if (syncTimer) {
      clearTimeout(syncTimer);
    }
    syncTimer = setTimeout(
      () => syncPreviewToCursor(fileName, line),
      SYNC_DEBOUNCE_MS,
    );
    // Moving into another division means showing that division: the cursor
    // leads, and a division picked from a summary page stops being pinned.
    if (
      previewMode === "live" &&
      activeHost &&
      cursorLeftRenderedDivision(fileName, line)
    ) {
      pinnedDivision = undefined;
      const host = activeHost;
      if (divisionTimer) {
        clearTimeout(divisionTimer);
      }
      divisionTimer = setTimeout(() => {
        divisionTimer = undefined;
        renderToPanel(host);
      }, FOLLOW_DEBOUNCE_MS);
    }
  });
}

/**
 * Show the division a summary-page link leads to, as picked in the preview.
 * The source is not moved — the reader asked to look, not to go — so the
 * division stays pinned until the cursor moves into another one.
 */
function showDivision(id: string): void {
  if (!activeHost || previewMode !== "live" || previewScope() !== "division") {
    return;
  }
  pinnedDivision = id;
  renderToPanel(activeHost);
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
    const document = await workspace.openTextDocument(toUri(entry.file));
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
  typingWatcher?.dispose();
  typingWatcher = undefined;
  if (typingTimer) {
    clearTimeout(typingTimer);
    typingTimer = undefined;
  }
  lastRenderedVersion = undefined;
  selectionWatcher?.dispose();
  selectionWatcher = undefined;
  panelMessageWatcher?.dispose();
  panelMessageWatcher = undefined;
  themeWatcher?.dispose();
  themeWatcher = undefined;
  disposeAssetWatchers();
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
  if (divisionTimer) {
    clearTimeout(divisionTimer);
    divisionTimer = undefined;
  }
  pinnedDivision = undefined;
  sourceMapByFile = undefined;
  sourceMapById = undefined;
  lastRender = undefined;
  // A toggled view lasts as long as the panel does; the next one starts from
  // the setting again. Same for a picked printout, which does not even outlive
  // moving the preview to another file.
  revealViewOverride = undefined;
  printoutChoice = undefined;
  printoutChoicePath = undefined;
  void commands.executeCommand(
    "setContext",
    "pretext-tools.previewIsSlideshow",
    false,
  );
  // The CLI server outlives our worker, so it needs an explicit stop. Kept
  // running while the panel is open (even in live mode) so toggling back to
  // the full build is instant.
  activeHost?.fullBuild?.stop();
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
    worker.dispose();
    worker = undefined;
  }
  pendingRequestId = undefined;
  renderQueued = false;
  pendingFromTyping = false;
  queuedFromTyping = false;
  crashRetries = 0;
  currentSource = undefined;
  panelHasContent = false;
  deliveredHtml = undefined;
  webviewHasPage = false;
  deliveredKey = undefined;
  activeHost = undefined;
  disposing = false;
}
