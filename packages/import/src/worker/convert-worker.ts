/// <reference lib="webworker" />
/**
 * Worker entry: runs the import pipeline off the UI thread.
 *
 * This module is a bundler entry point, not a library export — hosts point
 * their own bundler at it (see `createWorkerEngine`). It deliberately imports
 * only from `../lib`, never from `../react`, so nothing pulls React into the
 * worker chunk.
 */
import { importProjectFromFiles } from "../lib/upload";
import type { WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

/**
 * Assets come back as `Uint8Array`; hand their buffers to the main thread
 * rather than structured-cloning megabytes of image data.
 *
 * A success result exposes the same bytes from four places (`assets`,
 * `outputAssets`, `project.assets`, `nativeProject.assets`), and those views
 * routinely share one underlying `ArrayBuffer`. Structured clone handles the
 * aliasing on its own, but listing a buffer in the transfer list twice throws
 * `DataCloneError`, so collect through a Set and transfer each buffer once.
 */
function transferablesFor(response: WorkerResponse): Transferable[] {
  if (response.type !== "result" || "pretextError" in response.result) {
    return [];
  }
  const result = response.result;
  const buffers = new Set<ArrayBuffer>();

  const collect = (view: Uint8Array | undefined) => {
    // A view may be a window onto a larger buffer; transferring the whole
    // buffer is still correct, and the Set keeps it to one mention.
    const buffer = view?.buffer;
    if (buffer instanceof ArrayBuffer) {
      buffers.add(buffer);
    }
  };

  Object.values(result.assets ?? {}).forEach(collect);
  Object.values(result.outputAssets ?? {}).forEach(collect);
  result.project?.assets?.forEach((asset) => collect(asset.data));
  result.nativeProject?.assets?.forEach((asset) => collect(asset.data));

  return [...buffers];
}

function post(response: WorkerResponse): void {
  self.postMessage(response, transferablesFor(response));
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request?.type !== "convert") {
    return;
  }
  const { requestId, files, assets, options } = request;

  try {
    const result = importProjectFromFiles(files, { ...options, assets });
    post({ type: "result", requestId, result });
  } catch (error) {
    post({
      type: "error",
      requestId,
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.",
    });
  }
};
