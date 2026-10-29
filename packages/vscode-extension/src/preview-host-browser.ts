/**
 * The browser implementation of preview-host.ts (github.dev, vscode.dev):
 * the render worker is out/instant-preview-worker.web.js in a Web Worker
 * next to the extension, and there is no full-build mode (no PreTeXt CLI).
 *
 * The worker has no filesystem, so this side answers its reads: project
 * files through `workspace.fs` (by the virtual paths of virtual-path.ts),
 * and the extension's own bundled files — the WebAssembly binary handed over
 * at start, the stylesheets on demand — through `workspace.fs` where the host
 * serves the extension that way, or `fetch` where it is served over http(s)
 * (the same fallback the language client uses for its schema assets).
 *
 * Keep this file free of Node built-ins: it ships in the browser bundle.
 */
import { ExtensionContext, Uri, workspace } from "vscode";
import type { PreviewHost, PreviewWorker } from "./preview-host";
import {
  isRenderResponse,
  isWorkerReadRequest,
  type HostToWorkerMessage,
  type RenderResponse,
  type WorkerReadRequest,
  type WorkerToHostMessage,
} from "./preview-protocol";
import { pathToUri } from "./virtual-path";
import { readFileBytes } from "./workspace-fs";

// The browser extension host provides the Web Worker API; the extension's
// tsconfig targets Node, so declare the part used here.
declare class Worker {
  constructor(scriptURL: string);
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: "error",
    listener: (event: { message?: string }) => void,
  ): void;
  terminate(): void;
}

/** The files of this extension the worker needs, relative to its root. */
const WASM_PATH = ["out", "libxslt.wasm"];
const ASSETS_PATH = ["assets", "pretext-html"];

/**
 * Chromium ships WebAssembly JSPI; the others do not yet. The extension host
 * and the worker it makes run in the same browser, so asking here is asking
 * for the worker.
 */
export function previewJspiAvailable(): boolean {
  const wasm = (globalThis as { WebAssembly?: object }).WebAssembly;
  return !!wasm && "Suspending" in wasm;
}

export function browserPreviewHost(context: ExtensionContext): PreviewHost {
  return {
    launchWorker: () => launchBrowserWorker(context),
  };
}

function launchBrowserWorker(context: ExtensionContext): PreviewWorker {
  if (!previewJspiAvailable()) {
    throw new Error(
      "The live preview runs the PreTeXt stylesheets as WebAssembly and " +
        "needs the JavaScript Promise Integration (JSPI) feature, which this " +
        "browser does not provide. Chrome and Edge 137 or newer do; the " +
        "preview also works in desktop VS Code and in a Codespace.",
    );
  }
  const scriptUri = Uri.joinPath(
    context.extensionUri,
    "out",
    "instant-preview-worker.web.js",
  );
  const worker = new Worker(scriptUri.toString(true));

  const messageListeners: ((response: RenderResponse) => void)[] = [];
  const exitListeners: ((event: {
    description: string;
    failedToStart: boolean;
  }) => void)[] = [];
  const logListeners: ((line: string) => void)[] = [];
  let disposed = false;
  let heard = false;

  const post = (message: HostToWorkerMessage) => worker.postMessage(message);
  const log = (line: string) =>
    logListeners.forEach((listener) => listener(line));
  const exit = (description: string, failedToStart: boolean) => {
    if (disposed) {
      return;
    }
    disposed = true;
    worker.terminate();
    exitListeners.forEach((listener) =>
      listener({ description, failedToStart }),
    );
  };

  worker.addEventListener("message", (event) => {
    heard = true;
    const message = event.data as WorkerToHostMessage;
    if (isWorkerReadRequest(message)) {
      void answerRead(context, message).then(post);
    } else if (isRenderResponse(message)) {
      messageListeners.forEach((listener) => listener(message));
    } else if (message?.type === "log") {
      log(message.line);
    } else if (message?.type === "exit") {
      exit(message.detail, false);
    }
  });
  worker.addEventListener("error", (event) => {
    log(`worker error: ${event.message ?? "unknown"}`);
    exit(
      heard
        ? `worker error: ${event.message ?? "unknown"}`
        : "Instant preview could not start its render worker. Check the PreTeXt output log.",
      !heard,
    );
  });

  // The WebAssembly binary: the one thing the worker needs before it can do
  // anything, so it goes first. The worker's bootstrap waits for it.
  void readExtensionFile(context, WASM_PATH).then((wasm) => {
    if (disposed) {
      return;
    }
    if (!wasm) {
      exit(
        "Instant preview could not read its WebAssembly binary (out/libxslt.wasm). Check the PreTeXt output log.",
        true,
      );
      return;
    }
    post({ type: "init", wasm });
  });

  return {
    send: post,
    onMessage: (listener) => void messageListeners.push(listener),
    onExit: (listener) => void exitListeners.push(listener),
    onLog: (listener) => void logListeners.push(listener),
    dispose() {
      disposed = true;
      worker.terminate();
    },
  };
}

async function answerRead(
  context: ExtensionContext,
  request: WorkerReadRequest,
): Promise<HostToWorkerMessage> {
  const bytes =
    request.kind === "asset"
      ? await readExtensionFile(context, [
          ...ASSETS_PATH,
          ...request.path.split("/"),
        ])
      : await readProjectFile(request.path);
  return { type: "readResult", id: request.id, bytes };
}

/** A project file, by the virtual path the renderer knows it by. */
async function readProjectFile(
  virtualPath: string,
): Promise<Uint8Array | undefined> {
  try {
    return await workspace.fs.readFile(Uri.parse(pathToUri(virtualPath)));
  } catch {
    return undefined;
  }
}

/** One of the extension's own files, by path segments under its root. */
async function readExtensionFile(
  context: ExtensionContext,
  segments: string[],
): Promise<Uint8Array | undefined> {
  // The worker is our own code, but a `..` in a path it relays from a
  // stylesheet `document()` call must still not climb out of the assets.
  if (segments.some((segment) => segment === ".." || segment === "")) {
    return undefined;
  }
  return readFileBytes(Uri.joinPath(context.extensionUri, ...segments));
}
