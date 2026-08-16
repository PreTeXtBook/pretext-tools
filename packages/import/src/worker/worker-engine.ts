/**
 * Runs the import pipeline on a worker.
 *
 * The wizard already delegates the source → result step to a pluggable engine
 * (the VS Code host ships two: an in-webview one and a pandoc bridge that
 * round-trips to the extension host). Running the pipeline in a worker is just
 * a third engine, so no wizard code needs to know a worker exists.
 *
 * ## Why the host supplies `createWorker`
 *
 * This package externalizes `@pretextbook/format`, `@pretextbook/latex-pretext`
 * and `@pretextbook/remark-pretext`, so a worker chunk built here would not be
 * self-contained — it would carry bare imports no browser can resolve. Every
 * host already runs its own bundler over this source (the VS Code webview and
 * the playground both build it through Vite), and only that bundler knows how
 * to emit a worker for its target. So hosts hand us a factory:
 *
 * ```ts
 * createWorkerEngine({
 *   createWorker: () =>
 *     new Worker(new URL("@pretextbook/import/worker", import.meta.url), {
 *       type: "module",
 *     }),
 * });
 * ```
 *
 * Note for the VS Code webview: its panel CSP is `default-src 'none'`, and
 * `worker-src` inherits from that through `child-src` — workers are blocked
 * until the panel adds an explicit `worker-src`.
 */
import { extractUpload, type ImportProjectOptions } from "../lib/upload";
import { analyzeImportSources } from "../lib/project/analyze";
import type { ImportEngine } from "../react/import-wizard";
import type { ImportedProjectResult } from "../lib/types";
import type { WorkerRequest, WorkerResponse } from "./protocol";

/** The minimum of the `Worker` API this engine uses. */
export interface ConversionWorker {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerResponse>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
}

export interface WorkerEngineOptions {
  /** Builds a fresh worker. Called once per conversion. */
  createWorker: () => ConversionWorker;
  id?: string;
  label?: string;
  description?: string;
  acceptExtensions?: string[];
}

/**
 * One conversion in flight. `cancel` terminates the worker outright — the
 * pipeline has no yield points, so a cooperative cancellation flag would never
 * be read; killing the thread is the only way to stop it mid-grind.
 */
export interface RunningConversion {
  result: Promise<ImportedProjectResult>;
  cancel: () => void;
}

/** Raised on the `result` promise when `cancel()` is called. */
export class ConversionCancelledError extends Error {
  constructor() {
    super("Import cancelled.");
    this.name = "ConversionCancelledError";
  }
}

let nextRequestId = 0;

/**
 * Run one conversion on a freshly spawned worker.
 *
 * A worker per conversion rather than a long-lived pooled one: cancellation is
 * `terminate()`, which destroys the thread, and the pipeline holds no state
 * worth keeping warm between runs. Spawn cost is milliseconds against a
 * multi-second conversion.
 */
export function runConversionInWorker(
  createWorker: () => ConversionWorker,
  files: Record<string, string>,
  options: ImportProjectOptions = {},
): RunningConversion {
  const requestId = `convert-${nextRequestId++}`;
  const worker = createWorker();
  const { assets = {}, ...rest } = options;

  let settle: (() => void) | undefined;

  const result = new Promise<ImportedProjectResult>((resolve, reject) => {
    let done = false;
    const finish = (run: () => void) => {
      if (done) return;
      done = true;
      worker.terminate();
      run();
    };
    settle = () => finish(() => reject(new ConversionCancelledError()));

    worker.addEventListener("message", (event) => {
      const response = event.data;
      // A terminated worker cannot deliver anything, but guard the id anyway
      // so a host that reuses a worker never crosses two runs' messages.
      if (!response || response.requestId !== requestId) {
        return;
      }
      if (response.type === "result") {
        finish(() => resolve(response.result));
        return;
      }
      finish(() => reject(new Error(response.message)));
    });

    worker.addEventListener("error", (event) => {
      const message =
        typeof event === "object" && event && "message" in event
          ? String((event as { message: unknown }).message)
          : "The import worker failed to start.";
      finish(() => reject(new Error(message)));
    });
  });

  // Transfer the uploaded bytes in rather than copying them; the main thread
  // has no further use for the originals once conversion owns them.
  const transfer = [
    ...new Set(
      Object.values(assets)
        .map((asset) => asset.buffer)
        .filter(
          (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
        ),
    ),
  ];
  worker.postMessage(
    { type: "convert", requestId, files, assets, options: rest },
    transfer,
  );

  return { result, cancel: () => settle?.() };
}

/**
 * Build an `ImportEngine` that converts on a worker.
 *
 * `prepare` stays on the main thread: unpacking is real async I/O that already
 * yields, and it is cheap next to the conversion. Only `convertPrepared` and
 * `convertFile` — the multi-second synchronous grind — go off-thread.
 *
 * The returned engine is stateful: it remembers the run in flight so `cancel`
 * can terminate it. One engine instance therefore drives one wizard.
 */
export function createWorkerEngine(options: WorkerEngineOptions): ImportEngine {
  const {
    createWorker,
    id = "worker",
    label = "Built-in converter",
    description = "Create a new project starting with LaTeX, Markdown, or PreTeXt files.",
    acceptExtensions,
  } = options;

  let running: RunningConversion | null = null;

  const convert = async (
    files: Record<string, string>,
    importOptions: ImportProjectOptions,
  ): Promise<ImportedProjectResult> => {
    // A previous run left behind (the user backed out without cancelling)
    // would otherwise keep a worker alive burning CPU on a result nobody wants.
    running?.cancel();
    running = runConversionInWorker(createWorker, files, importOptions);
    try {
      return await running.result;
    } finally {
      running = null;
    }
  };

  return {
    id,
    label,
    description,
    acceptExtensions,
    prepare: async (file) => {
      const { files, assets } = await extractUpload(file);
      return {
        fileName: file.name,
        files,
        assets,
        analysis: analyzeImportSources(files),
      };
    },
    convertPrepared: (prepared, importOptions) =>
      convert(prepared.files, { ...importOptions, assets: prepared.assets }),
    convertFile: async (file, importOptions) => {
      const { files, assets } = await extractUpload(file);
      return convert(files, { ...importOptions, assets });
    },
    cancel: () => {
      running?.cancel();
      running = null;
    },
  };
}
