/**
 * Entry point for the instant-preview worker process (desktop VS Code).
 *
 * Bundled by esbuild (see build.mjs) into out/instant-preview-worker.mjs and
 * launched by preview-host-node.ts. The XSLT engine (libxslt-wasm) needs
 * WebAssembly JSPI, which older Node only enables behind
 * `--experimental-wasm-jspi`; the launcher picks a runtime/flags that provide
 * it. The PRETEXT_HTML_ASSETS env var points the renderer at the copied
 * assets (preview-html.xsl + vendored PreTeXt xsl tree).
 *
 * Two modes:
 *
 * - Persistent "serve" mode (`--serve`): the process stays alive and answers
 *   render requests over the Node IPC channel (the protocol and serve loop
 *   are in preview-protocol.ts, shared with the Web Worker twin of this file,
 *   instant-preview-worker.web.ts).
 *
 * - One-shot CLI mode (no `--serve`): render one document to stdout and exit.
 *   Retained for standalone use and debugging.
 */
import { renderHtml, runCli } from "@pretextbook/pretext-html";
import { createRenderServer, isRenderRequest } from "./preview-protocol";

function serve(): void {
  const send = process.send?.bind(process);
  if (!send) {
    console.error(
      "instant-preview-worker: --serve requires an IPC channel (the process " +
        "must be forked or spawned with an 'ipc' stdio slot).",
    );
    process.exit(1);
  }

  const handle = createRenderServer({
    render: renderHtml,
    send,
    log: (line) => console.error(`instant-preview-worker: ${line}`),
    // The instance may be corrupted; exit so the parent relaunches a fresh
    // worker for the next render. Delay a tick to let the reply flush over
    // IPC first.
    onFatal: () => setTimeout(() => process.exit(1), 50),
  });

  process.on("message", (message: unknown) => {
    if (isRenderRequest(message)) {
      handle(message);
    }
  });

  // A render failure is reported per-request; never let a stray async error
  // take down the long-lived process.
  process.on("unhandledRejection", (reason) => {
    console.error(
      `instant-preview-worker: unhandled rejection: ${String(reason)}`,
    );
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
