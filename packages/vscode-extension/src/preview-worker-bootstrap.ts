/**
 * The first thing the web preview worker runs: the host message channel, and
 * a `fetch` that answers two fake origins out of it.
 *
 * `@pretextbook/libxslt-wasm` instantiates its WebAssembly module as a side
 * effect of being imported (a module-level `await`), and the Emscripten glue
 * finds the binary with `fetch(new URL("libxslt.wasm", import.meta.url))`.
 * Neither suits a VS Code web extension's nested worker: the worker is
 * bootstrapped through a `blob:` script that `importScripts` ours, so there
 * is no usable `import.meta.url`, and the extension's own files are not
 * necessarily fetchable from the worker's origin.
 *
 * So the build defines `import.meta.url` as {@link WORKER_FAKE_URL}, which
 * makes the glue ask for {@link WASM_FAKE_URL}; this module, imported before
 * anything else by instant-preview-worker.web.ts, wraps `fetch` to answer that
 * one URL with bytes the host sends in its `init` message — the host reads
 * out/libxslt.wasm through `workspace.fs` (or `fetch`, where that is what
 * serves the extension) and posts them. The glue only ever sees a successful
 * same-origin-looking fetch.
 *
 * The renderer's browser platform likewise `fetch`es its stylesheets from
 * wherever `setAssetsBase` points. The worker points it at
 * {@link ASSETS_ORIGIN}, and the same wrapper answers those from the
 * extension's bundled `assets/pretext-html/` through the host
 * ({@link readFromHost}). Every read the renderer makes — mounted
 * stylesheet, wrapper, project file — ends up in that one function.
 *
 * This is also the single `message` listener of the worker: every other
 * handler registers with {@link onHostMessage}. Registering here,
 * synchronously, at the top of the script is what makes an `init` posted right
 * after the worker was constructed safe — it is queued until the script's
 * synchronous part has run, which includes this listener.
 */
import type {
  HostToWorkerMessage,
  WorkerReadKind,
  WorkerToHostMessage,
} from "./preview-protocol";

/** What the bundle's `import.meta.url` is defined as (see build.mjs). */
export const WORKER_FAKE_URL = "http://wasm.ptx.invalid/worker.js";
/** Where the Emscripten glue consequently looks for the binary. */
export const WASM_FAKE_URL = "http://wasm.ptx.invalid/libxslt.wasm";
/**
 * The origin the renderer is told its `assets/` are served from. Nothing is
 * ever really fetched from it: the `.invalid` TLD is reserved, and the
 * wrapper below answers it from the host. A URL rather than a bare path
 * because the renderer's browser platform resolves asset reads with
 * `new URL(relative, root)`.
 */
export const ASSETS_ORIGIN = "http://assets.ptx.invalid";

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  postMessage(message: unknown): void;
  close(): void;
  fetch: typeof fetch;
}

/** The worker's global scope (tsconfig targets Node, so declare what is used). */
export const workerScope = globalThis as unknown as WorkerScope;

export function postToHost(message: WorkerToHostMessage): void {
  workerScope.postMessage(message);
}

type HostMessageListener = (message: HostToWorkerMessage) => void;
const listeners: HostMessageListener[] = [];

/** Subscribe to messages from the extension host (other than reads/init). */
export function onHostMessage(listener: HostMessageListener): void {
  listeners.push(listener);
}

// ── Reads through the host ──────────────────────────────────────────────────

let nextReadId = 1;
const pendingReads = new Map<number, (bytes: Uint8Array | undefined) => void>();

/**
 * Read a file through the host: a project file by its (virtual) absolute
 * path, or a file of the extension's bundled `assets/pretext-html/` by its
 * relative path. Resolves undefined when there is no such file.
 */
export function readFromHost(
  kind: WorkerReadKind,
  filePath: string,
): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    const id = nextReadId++;
    pendingReads.set(id, resolve);
    postToHost({ type: "read", id, kind, path: filePath });
  });
}

let resolveWasm: ((bytes: Uint8Array) => void) | undefined;
const wasmBytes = new Promise<Uint8Array>((resolve) => {
  resolveWasm = resolve;
});

workerScope.addEventListener("message", (event) => {
  const message = event.data as HostToWorkerMessage | undefined;
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "init") {
    resolveWasm?.(message.wasm);
    resolveWasm = undefined;
    return;
  }
  if (message.type === "readResult") {
    const resolve = pendingReads.get(message.id);
    pendingReads.delete(message.id);
    resolve?.(message.bytes);
    return;
  }
  for (const listener of listeners) {
    listener(message);
  }
});

// ── The fetch wrapper ───────────────────────────────────────────────────────

function respond(bytes: Uint8Array, contentType: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

const realFetch = workerScope.fetch;
workerScope.fetch = ((
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as { url: string }).url;
  if (url === WASM_FAKE_URL) {
    // `instantiateStreaming` insists on this content type; the glue falls
    // back to `arrayBuffer()` + `instantiate` if it is ever refused anyway.
    return wasmBytes.then((bytes) => respond(bytes, "application/wasm"));
  }
  if (url.startsWith(`${ASSETS_ORIGIN}/`)) {
    const assetPath = decodeURIComponent(new URL(url).pathname).replace(
      /^\/+/,
      "",
    );
    return readFromHost("asset", assetPath).then((bytes) =>
      bytes === undefined
        ? new Response("not found", { status: 404 })
        : respond(bytes, "application/octet-stream"),
    );
  }
  return realFetch(input, init);
}) as typeof fetch;
