/**
 * Message protocol between the wizard and a conversion worker.
 *
 * The pipeline (`importProjectFromFiles`) is a single synchronous grind with
 * no yield points — roughly 15ms per KB of LaTeX source, so a 250KB textbook
 * blocks its thread for ~4s and a 1MB one for ~15s. Running it on the UI
 * thread freezes the tab for that whole stretch: the spinner cannot paint, the
 * elapsed timer cannot tick, and Cancel cannot respond. Moving it behind a
 * worker keeps all three alive.
 *
 * There is deliberately no progress message. The pipeline's one expensive step
 * is a single opaque `latexToPretext()` call (~90% of the time) that cannot
 * report from inside, so any phase breakdown would race through the cheap
 * stages and then stall — the wizard shows elapsed time instead.
 *
 * Kept in its own module so both sides can import the types without either
 * pulling in the other's runtime: the worker entry must stay free of React,
 * and the wizard must stay free of the pipeline.
 */
import type { ImportProjectOptions } from "../lib/upload";
import type { ImportedProjectResult } from "../lib/types";

/** Sent to the worker to start a conversion. */
export interface ConvertRequest {
  type: "convert";
  /** Correlates the reply, so a stale run's messages can be ignored. */
  requestId: string;
  files: Record<string, string>;
  /**
   * Binary assets, sent as transferables. Carried here rather than inside
   * `options` so the buffers can be listed in the `postMessage` transfer list
   * instead of being structured-cloned.
   */
  assets: Record<string, Uint8Array>;
  /** Everything except `assets`, which travels in its own field above. */
  options: Omit<ImportProjectOptions, "assets">;
}

export type WorkerRequest = ConvertRequest;

export interface ResultResponse {
  type: "result";
  requestId: string;
  result: ImportedProjectResult;
}

/** A throw that escaped the pipeline — distinct from a `pretextError` result. */
export interface ErrorResponse {
  type: "error";
  requestId: string;
  message: string;
}

export type WorkerResponse = ResultResponse | ErrorResponse;
