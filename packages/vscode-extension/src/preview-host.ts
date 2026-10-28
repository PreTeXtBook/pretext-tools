/**
 * What the live preview (instantPreview.ts) needs from the host it runs on,
 * and cannot do the same way on both.
 *
 * The preview itself is host-neutral: it reads the project through
 * `workspace.fs`, keeps paths in the space of virtual-path.ts, and talks to
 * its render worker through the messages of preview-protocol.ts. Two things
 * differ by host and are injected through this interface:
 *
 * - how the render worker is launched — a forked Node process with
 *   WebAssembly JSPI enabled on the desktop (preview-host-node.ts), a Web
 *   Worker on github.dev / vscode.dev (preview-host-browser.ts);
 * - whether a full `pretext build` can be shown instead — only where the
 *   PreTeXt CLI is (desktop); the toolbar offers the mode only when it can.
 *
 * Types only; both entry points implement it.
 */
import type { RenderRequest, RenderResponse } from "./preview-protocol";

/** A running render worker, whatever it is made of. */
export interface PreviewWorker {
  /** Ask for a render. The answer arrives through `onMessage`. */
  send(request: RenderRequest): void;
  onMessage(listener: (response: RenderResponse) => void): void;
  /**
   * The worker is gone, and not because `dispose` was called: it crashed, or
   * never started. `failedToStart` tells the two apart — a crash mid-render
   * is retried, a runtime that cannot be launched is not.
   */
  onExit(
    listener: (event: { description: string; failedToStart: boolean }) => void,
  ): void;
  /** Diagnostics for the output log (the worker's stderr, say). */
  onLog(listener: (line: string) => void): void;
  /** Shut the worker down. No `onExit` for this. */
  dispose(): void;
}

/** A `pretext build` target: the project and the target name to build. */
export interface FullBuildTarget {
  projectDir: string;
  target: string;
}

/** The `pretext build` / `pretext view` side of the toolbar, where there is one. */
export interface FullBuildBridge {
  /** Start (if needed) the server for a built target; resolves with its URL. */
  ensureServer(target: FullBuildTarget): Promise<string>;
  /** Run `pretext build`; true when it produced HTML output. */
  build(target: FullBuildTarget): Promise<boolean>;
  /** The served URL of a target whose server is running, if any. */
  servedUrl(target: FullBuildTarget): string | undefined;
  /** Stop the server (the preview panel closed). */
  stop(): void;
}

export interface PreviewHost {
  /**
   * Launch the render worker. Throws, with a message fit to show the user,
   * when this host cannot run one (no runtime with WebAssembly JSPI).
   */
  launchWorker(): PreviewWorker;
  /** Absent where the PreTeXt CLI is not: the toolbar then has no such mode. */
  fullBuild?: FullBuildBridge;
}
