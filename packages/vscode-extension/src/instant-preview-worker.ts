/**
 * Entry point for the instant-preview worker process.
 *
 * Bundled by esbuild (see build.mjs) into out/instant-preview-worker.mjs and
 * launched by instantPreview.ts. The XSLT engine (libxslt-wasm) needs
 * WebAssembly JSPI, which older Node only enables behind
 * `--experimental-wasm-jspi`; the launcher picks a runtime/flags that provide
 * it. The PRETEXT_HTML_ASSETS env var points the renderer at the copied
 * assets (preview-html.xsl + vendored PreTeXt xsl tree).
 *
 * Two modes:
 *
 * - Persistent "serve" mode (`--serve`): the process stays alive and answers
 *   render requests over the Node IPC channel. This is the mode the extension
 *   uses, because keeping the process alive reuses the loaded WASM module and
 *   the compiled stylesheet (the expensive ~600ms cold start), turning
 *   subsequent renders into ~100ms transforms.
 *
 * - One-shot CLI mode (no `--serve`): render one document to stdout and exit.
 *   Retained for standalone use and debugging.
 */
import {
  renderHtml,
  runCli,
  type PtxSourceMap,
  type RenderOptions,
} from "@pretextbook/pretext-html";

/** Request sent by the extension over IPC. */
interface RenderRequest {
  id: number;
  type: "render";
  sourcePath: string;
  projectDir?: string;
  publicationPath?: string;
  fragment?: boolean;
  /** A <docinfo> element (as a string) injected into a fragment wrapper. */
  docinfo?: string;
  /** Main source file to lift <docinfo> from (fragment mode); see renderer. */
  docinfoSourcePath?: string;
  /** Also compute the id → file/line source map (for editor sync). */
  sourceMap?: boolean;
}

/** Response sent back over IPC. */
type RenderResponse =
  | {
      id: number;
      ok: true;
      html: string;
      elapsedMs: number;
      sourceMap?: PtxSourceMap;
    }
  | { id: number; ok: false; error: string };

function isRenderRequest(value: unknown): value is RenderRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "render" &&
    typeof (value as { id?: unknown }).id === "number" &&
    typeof (value as { sourcePath?: unknown }).sourcePath === "string"
  );
}

/**
 * A WebAssembly out-of-bounds trap (the whole-book stack overflow) can leave
 * the libxslt instance in an undefined state, so after one the process must be
 * recycled rather than kept serving. Ordinary render errors — malformed XML
 * from a mid-edit save, a missing file — are clean libxml2/JS errors that
 * leave the instance usable, so they must NOT trigger a recycle (that would
 * throw away the warm compiled stylesheet on every typo). Match only the
 * fatal-trap signature, checking the cause chain too since the renderer wraps
 * the raw trap in a friendlier message.
 */
function isFatalWasmError(error: unknown): boolean {
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

function serve(): void {
  const send = process.send?.bind(process);
  if (!send) {
    console.error(
      "instant-preview-worker: --serve requires an IPC channel (the process " +
        "must be forked or spawned with an 'ipc' stdio slot).",
    );
    process.exit(1);
  }

  // Process requests strictly in order. renderHtml shares module-level WASM
  // state (the libxslt instance and stylesheet cache), so overlapping renders
  // in one process are not safe; the chain serializes them.
  let queue: Promise<void> = Promise.resolve();

  process.on("message", (message: unknown) => {
    if (!isRenderRequest(message)) {
      return;
    }
    const request = message;
    queue = queue.then(async () => {
      const started = Date.now();
      const options: RenderOptions = {
        sourcePath: request.sourcePath,
        projectDir: request.projectDir,
        publicationPath: request.publicationPath,
        fragment: request.fragment,
        docinfo: request.docinfo,
        docinfoSourcePath: request.docinfoSourcePath,
        sourceMap: request.sourceMap,
      };
      try {
        const { html, sourceMap } = await renderHtml(options);
        const response: RenderResponse = {
          id: request.id,
          ok: true,
          html,
          elapsedMs: Date.now() - started,
          sourceMap,
        };
        send(response);
      } catch (error) {
        const response: RenderResponse = {
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
        send(response);
        if (isFatalWasmError(error)) {
          // The instance may be corrupted; exit so the parent relaunches a
          // fresh worker for the next render. Delay a tick to let the reply
          // flush over IPC first.
          console.error(
            "instant-preview-worker: fatal WebAssembly error; recycling process.",
          );
          setTimeout(() => process.exit(1), 50);
        }
      }
    });
  });

  // A render failure is reported per-request; never let a stray async error
  // take down the long-lived process.
  process.on("unhandledRejection", (reason) => {
    console.error(`instant-preview-worker: unhandled rejection: ${String(reason)}`);
  });

  // Exit when the parent disconnects (panel closed / extension deactivated).
  process.on("disconnect", () => process.exit(0));
}

if (process.argv.slice(2).includes("--serve")) {
  serve();
} else {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      `instant-preview-worker: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  });
}
