/**
 * The message protocol between the live preview (instantPreview.ts, in the
 * extension host) and its render worker — a forked Node process on the
 * desktop (instant-preview-worker.ts), a Web Worker on github.dev /
 * vscode.dev (instant-preview-worker.web.ts). Both workers answer the same
 * `render` request with the same response; the serve loop that does so is
 * {@link createRenderServer}, shared by both.
 *
 * Nothing here may import `vscode` or a Node built-in: the host, both
 * workers and the unit tests all load it. `@pretextbook/pretext-html` is
 * imported for its types only — the runtime package is ESM with a top-level
 * await and lives in the worker, never in the host bundle.
 */
import type {
  PreviewBannerOptions,
  PreviewTheme,
  PrintoutInfo,
  PtxSourceMap,
  RenderOptions,
  RenderResult,
  RenderTarget,
  RevealView,
  SubtreeOptions,
} from "@pretextbook/pretext-html";

/** A render, as the host asks for it. */
export interface RenderRequest {
  id: number;
  type: "render";
  sourcePath: string;
  /**
   * Unsaved editor text to render instead of reading `sourcePath` (which
   * still anchors its xi:includes); see RenderOptions.sourceContent.
   */
  sourceContent?: string;
  /** The project's main source file; anchors publication-relative asset dirs. */
  mainSourcePath?: string;
  projectDir?: string;
  publicationPath?: string;
  /** HTML theme for projects whose publication file names none; see renderer. */
  cssTheme?: string;
  fragment?: boolean;
  /** A <docinfo> element (as a string) injected into a fragment wrapper. */
  docinfo?: string;
  /** Main source file to lift <docinfo> from (fragment mode); see renderer. */
  docinfoSourcePath?: string;
  /**
   * The complete document a fragment belongs to. Renders the fragment in place
   * in it, so its numbering and cross-references match the built book rather
   * than restarting at 1; see RenderOptions.contextSourcePath.
   */
  contextSourcePath?: string;
  /** Also compute the id → file/line source map (for editor sync). */
  sourceMap?: boolean;
  /** Initial light/dark theme baked into the page (see @pretextbook/pretext-html). */
  theme?: PreviewTheme;
  /** How a slideshow opens: whole deck scrolling, or one slide at a time. */
  revealView?: RevealView;
  /** reveal.js theme for decks whose publication file names none. */
  revealTheme?: string;
  /** Fraction of the pane a slide fills in the scroll view (zoom). */
  revealZoom?: number;
  /** Dismissible "this is a live preview" banner; see @pretextbook/pretext-html. */
  previewBanner?: PreviewBannerOptions;
  /**
   * Preview one division — the one around the cursor, or a named one — of
   * the document rather than all of it; see RenderOptions.subtree.
   */
  subtree?: SubtreeOptions;
  /**
   * Unsaved editor buffers of other project files, by absolute path, so the
   * context document and xi:includes see what the editor sees; see
   * RenderOptions.files.
   */
  files?: Record<string, string>;
}

/** The one division a page shows, when not the whole document. */
export type RenderedSubtree = RenderResult["subtree"];

/** A render's outcome, as the worker reports it. */
export type RenderResponse =
  | {
      id: number;
      ok: true;
      html: string;
      elapsedMs: number;
      /**
       * Which conversion ran. The host shows slideshow-only UI (the view
       * toggle) on the strength of this, rather than re-reading the source to
       * work out whether the page in the panel is a deck.
       */
      target: RenderTarget;
      sourceMap?: PtxSourceMap;
      /** Real directories behind the page's `external/`/`generated/` URLs. */
      assetDirs?: { external?: string; generated: string };
      /**
       * The page's printouts (worksheets, handouts, and projects with a
       * workspace), which the toolbar offers a print preview of. Entering that
       * layout is host-side work — it only re-injects a bridge into this same
       * HTML — so just the menu has to travel.
       */
      printouts: PrintoutInfo[];
      /** The printout to open in print preview by default, if there is one. */
      rootPrintout?: string;
      /** The one division shown, when not the whole document. */
      subtree?: RenderedSubtree;
    }
  | { id: number; ok: false; error: string };

export function isRenderRequest(value: unknown): value is RenderRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "render" &&
    typeof (value as { id?: unknown }).id === "number" &&
    typeof (value as { sourcePath?: unknown }).sourcePath === "string"
  );
}

export function isRenderResponse(value: unknown): value is RenderResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "number" &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

/** The renderer options a request translates to, field for field. */
export function renderOptionsFrom(request: RenderRequest): RenderOptions {
  return {
    sourcePath: request.sourcePath,
    sourceContent: request.sourceContent,
    mainSourcePath: request.mainSourcePath,
    projectDir: request.projectDir,
    publicationPath: request.publicationPath,
    cssTheme: request.cssTheme,
    fragment: request.fragment,
    docinfo: request.docinfo,
    docinfoSourcePath: request.docinfoSourcePath,
    contextSourcePath: request.contextSourcePath,
    sourceMap: request.sourceMap,
    theme: request.theme,
    revealView: request.revealView,
    revealTheme: request.revealTheme,
    revealZoom: request.revealZoom,
    previewBanner: request.previewBanner,
    subtree: request.subtree,
    files: request.files,
  };
}

/**
 * A WebAssembly out-of-bounds trap (the whole-book stack overflow) can leave
 * the libxslt instance in an undefined state, so after one the worker must be
 * recycled rather than kept serving. Ordinary render errors — malformed XML
 * from a mid-edit save, a missing file — are clean libxml2/JS errors that
 * leave the instance usable, so they must NOT trigger a recycle (that would
 * throw away the warm compiled stylesheet on every typo). Match only the
 * fatal-trap signature, checking the cause chain too since the renderer wraps
 * the raw trap in a friendlier message.
 */
export function isFatalWasmError(error: unknown): boolean {
  const pattern =
    /out of bounds|memory access|stack overflow|too large for the current WebAssembly|unreachable|RuntimeError/i;
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    if (pattern.test(current.message) || pattern.test(current.name)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface RenderServerDeps {
  /** The renderer; `renderHtml` from @pretextbook/pretext-html. */
  render: (options: RenderOptions) => Promise<RenderResult>;
  /** Deliver a response to the host. */
  send: (response: RenderResponse) => void;
  /**
   * Called after a response whose error was a fatal WebAssembly trap: the
   * instance may be corrupted, and the worker should exit so the host
   * relaunches a fresh one. Called after `send`, so the reply gets out first.
   */
  onFatal: () => void;
  /** Diagnostics, for the host's log. */
  log: (line: string) => void;
}

/**
 * The serve loop both workers run: answer each request with a render,
 * strictly in order. `renderHtml` shares module-level WASM state (the libxslt
 * instance and stylesheet cache), so overlapping renders in one worker are
 * not safe; the returned handler chains them. Keeping the worker alive
 * across requests is the point: the loaded WASM module and the compiled
 * stylesheet (the ~600ms cold start) are reused, so each later render is
 * just a ~100ms transform.
 */
export function createRenderServer(
  deps: RenderServerDeps,
): (request: RenderRequest) => void {
  let queue: Promise<void> = Promise.resolve();
  return (request) => {
    queue = queue.then(async () => {
      const started = Date.now();
      try {
        const {
          html,
          target,
          sourceMap,
          assetDirs,
          printouts,
          rootPrintout,
          subtree,
        } = await deps.render(renderOptionsFrom(request));
        deps.send({
          id: request.id,
          ok: true,
          html,
          elapsedMs: Date.now() - started,
          target,
          sourceMap,
          assetDirs,
          printouts,
          rootPrintout,
          subtree,
        });
      } catch (error) {
        deps.send({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        if (isFatalWasmError(error)) {
          deps.log("fatal WebAssembly error; recycling the render worker.");
          deps.onFatal();
        }
      }
    });
  };
}

// ── Web Worker transport ────────────────────────────────────────────────────
// The forked Node worker reads the project and the stylesheets from disk
// itself. The Web Worker has no filesystem: it asks the host for every file,
// and is handed the WebAssembly binary at start. These are the extra
// messages that transport needs.

/** Host → worker, before anything else: what the worker cannot fetch itself. */
export interface WorkerInitMessage {
  type: "init";
  /** The libxslt WebAssembly binary (out/libxslt.wasm). */
  wasm: Uint8Array;
}

/** What a worker read refers to. */
export type WorkerReadKind =
  /** A project file, by absolute (virtual) path; see src/virtual-path.ts. */
  | "project"
  /** A file of the extension's bundled `assets/pretext-html/`, by relative path. */
  | "asset";

/** Worker → host: please read this file. */
export interface WorkerReadRequest {
  type: "read";
  id: number;
  kind: WorkerReadKind;
  path: string;
}

/** Host → worker: the file's bytes, or nothing when it does not exist. */
export interface WorkerReadResponse {
  type: "readResult";
  id: number;
  bytes?: Uint8Array;
}

/** Worker → host: a line for the output log. */
export interface WorkerLogMessage {
  type: "log";
  line: string;
}

/**
 * Worker → host: the worker is about to close itself (a fatal WebAssembly
 * trap). A Web Worker's own `close()` is silent on the host side, so this
 * stands in for the process `exit` event the forked worker has.
 */
export interface WorkerExitMessage {
  type: "exit";
  detail: string;
}

export type HostToWorkerMessage =
  | RenderRequest
  | WorkerInitMessage
  | WorkerReadResponse;

export type WorkerToHostMessage =
  | RenderResponse
  | WorkerReadRequest
  | WorkerLogMessage
  | WorkerExitMessage;

export function isWorkerReadRequest(
  value: unknown,
): value is WorkerReadRequest {
  const v = value as Partial<WorkerReadRequest> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    v.type === "read" &&
    typeof v.id === "number" &&
    (v.kind === "project" || v.kind === "asset") &&
    typeof v.path === "string"
  );
}
