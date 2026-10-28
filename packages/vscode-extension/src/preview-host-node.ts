/**
 * The desktop implementation of preview-host.ts: the render worker is
 * out/instant-preview-worker.mjs in a forked Node process (WebAssembly JSPI
 * may need a process-level flag; see launchWorker for how the runtime is
 * chosen), and the full-build mode runs the PreTeXt CLI through
 * cliPreviewServer.ts.
 */
import { workspace } from "vscode";
import { ChildProcess, fork, spawn, spawnSync } from "child_process";
import * as path from "path";
import {
  ensureCliServer,
  runCliBuild,
  servedUrl,
  stopCliServer,
} from "./cliPreviewServer";
import type { PreviewHost, PreviewWorker } from "./preview-host";
import { isRenderResponse, type RenderResponse } from "./preview-protocol";
import { pretextOutputChannel } from "./ui-core";

export function nodePreviewHost(extensionPath: string): PreviewHost {
  return {
    launchWorker: () => launchNodeWorker(extensionPath),
    fullBuild: {
      ensureServer: ensureCliServer,
      build: runCliBuild,
      servedUrl,
      stop: stopCliServer,
    },
  };
}

function launchNodeWorker(extensionPath: string): PreviewWorker {
  const workerPath = path.join(
    extensionPath,
    "out",
    "instant-preview-worker.mjs",
  );
  // Throws when no runtime with JSPI can be found; the caller shows it.
  const child = launchProcess(workerPath, ["--serve"], {
    ...process.env,
    PRETEXT_HTML_ASSETS: path.join(extensionPath, "assets", "pretext-html"),
  });

  const messageListeners: ((response: RenderResponse) => void)[] = [];
  const exitListeners: ((event: {
    description: string;
    failedToStart: boolean;
  }) => void)[] = [];
  const logListeners: ((line: string) => void)[] = [];
  let disposed = false;

  // fork() with silent: true (and spawn with piped stdio) give us the
  // worker's stderr for diagnostics.
  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) {
      logListeners.forEach((listener) => listener(text));
    }
  });
  child.on("message", (message: unknown) => {
    if (isRenderResponse(message)) {
      messageListeners.forEach((listener) => listener(message));
    }
  });
  child.on("error", (err) => {
    // Typically the runtime could not be spawned at all.
    logListeners.forEach((listener) => listener(String(err)));
    if (!disposed) {
      exitListeners.forEach((listener) =>
        listener({
          description:
            "Instant preview could not start its Node.js worker. Check the PreTeXt output log.",
          failedToStart: true,
        }),
      );
    }
  });
  child.on("exit", (code, signal) => {
    if (!disposed) {
      exitListeners.forEach((listener) =>
        listener({
          description: `code=${code ?? "null"}, signal=${signal ?? "null"}`,
          failedToStart: false,
        }),
      );
    }
  });

  return {
    send(request) {
      child.send(request, (err) => {
        if (err) {
          // The channel died between launch and send; the exit handler
          // relaunches on the next render.
          logListeners.forEach((listener) =>
            listener(`Failed to send render request: ${String(err)}`),
          );
        }
      });
    },
    onMessage: (listener) => void messageListeners.push(listener),
    onExit: (listener) => void exitListeners.push(listener),
    onLog: (listener) => void logListeners.push(listener),
    dispose() {
      disposed = true;
      // disconnect() lets the worker exit cleanly on its 'disconnect'
      // handler; kill() is the backstop if it is wedged.
      child.disconnect?.();
      if (!child.killed) {
        child.kill();
      }
    },
  };
}

/** A runtime that can host the render worker, and how to invoke it. */
type NodeLaunch = {
  command: string;
  flags: string[];
  /** Extra environment this runtime needs (Electron's run-as-node switch). */
  env: NodeJS.ProcessEnv;
};

/** Cached result of probing which runtime/flags give us WebAssembly JSPI. */
let nodeLaunch: NodeLaunch | undefined;

/**
 * Flag spellings that have enabled JSPI across the V8 versions we may meet.
 * V8 renamed the flag mid-stream (--experimental-wasm-stack-switching became
 * --experimental-wasm-jspi), and the empty entry covers runtimes new enough to
 * have JSPI on by default. Node exits with "bad option" on a flag its V8 does
 * not know, so an unsupported spelling simply fails its probe and we move on.
 *
 * Note a runtime can accept the flag and still lack the API we need: V8 12.4
 * (all of Node 22) has only the older Suspender-era JSPI, so it takes the flag
 * and still reports no WebAssembly.Suspending. Probing for the API rather than
 * sniffing a version number is what keeps that case honest.
 */
const JSPI_FLAG_CANDIDATES: string[][] = [
  ["--experimental-wasm-jspi"],
  ["--experimental-wasm-stack-switching"],
  [],
];

/**
 * Launch the render worker in a process where WebAssembly JSPI is available.
 *
 * Almost no runtime we meet has JSPI on by default -- even V8 13.6 (Node 24)
 * still needs --experimental-wasm-jspi -- so this fast path, forking with the
 * flags already in effect, is mostly reserved for future runtimes that enable
 * it unconditionally. Everything else goes through resolveNodeLaunch, which
 * finds a runtime/flag pair that does expose WebAssembly.Suspending.
 *
 * Note the fallback is not "a system Node": resolveNodeLaunch prefers the
 * runtime already hosting this extension, so the common case needs no separate
 * Node installation at all.
 */
function launchProcess(
  workerPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): ChildProcess {
  // The extension's ts lib has no WebAssembly declarations; go via globalThis.
  const wasm = (globalThis as { WebAssembly?: object }).WebAssembly;
  if (wasm && "Suspending" in wasm) {
    // fork() always sets up an IPC channel; silent pipes stdio so we can read
    // the worker's stderr for diagnostics.
    return fork(workerPath, args, { execArgv: [], silent: true, env });
  }
  const { command, flags, env: runtimeEnv } = resolveNodeLaunch();
  // The 'ipc' stdio slot gives the spawned Node the same message channel a
  // fork would, so the serve protocol works identically on either path.
  return spawn(command, [...flags, workerPath, ...args], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...env, ...runtimeEnv },
  });
}

/**
 * Ask a candidate runtime whether it exposes JSPI under the given flags.
 * Returns a human-readable reason when it does not, for the output log.
 */
function probeJspi(
  command: string,
  flags: string[],
  env: NodeJS.ProcessEnv,
): { ok: boolean; detail: string } {
  const probe = spawnSync(
    command,
    [...flags, "-p", "'Suspending' in WebAssembly"],
    { encoding: "utf8", timeout: 10000, env: { ...process.env, ...env } },
  );
  if (probe.error) {
    // Typically ENOENT (no such binary on this process's PATH).
    return { ok: false, detail: probe.error.message };
  }
  if (probe.status === 0 && probe.stdout.trim() === "true") {
    return { ok: true, detail: "ok" };
  }
  const reason = (probe.stderr || probe.stdout).trim() || "no JSPI";
  return { ok: false, detail: `exit ${probe.status}: ${reason}` };
}

/**
 * Find a Node runtime with JSPI support for the render worker.
 *
 * Tries, in order: an explicitly configured nodePath, the runtime already
 * hosting this extension (VS Code Server's bundled Node in a remote/Codespaces
 * window, Electron on the desktop — which runs as plain Node when
 * ELECTRON_RUN_AS_NODE is set), then `node` from PATH. Each is probed against
 * every flag spelling in JSPI_FLAG_CANDIDATES. Using the extension host's own
 * runtime mirrors what pretext-html's CLI does with process.execPath, and lets
 * the preview work with no separate Node installation at all.
 *
 * Throws with install/configuration advice, having logged every attempt.
 */
function resolveNodeLaunch(): NodeLaunch {
  if (nodeLaunch) {
    return nodeLaunch;
  }
  const configured = workspace
    .getConfiguration("pretext-tools")
    .get<string>("instantPreview.nodePath")
    ?.trim();

  const candidates: {
    command: string;
    env: NodeJS.ProcessEnv;
    label: string;
  }[] = [];
  if (configured) {
    candidates.push({ command: configured, env: {}, label: configured });
  }
  candidates.push({
    command: process.execPath,
    // Harmless on a plain Node; required for Electron to behave as Node.
    env: { ELECTRON_RUN_AS_NODE: "1" },
    label: `extension host runtime (${process.execPath})`,
  });
  candidates.push({ command: "node", env: {}, label: '"node" on PATH' });

  const attempts: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.command)) {
      continue;
    }
    seen.add(candidate.command);
    for (const flags of JSPI_FLAG_CANDIDATES) {
      const shown = flags.join(" ") || "(no flags)";
      const result = probeJspi(candidate.command, flags, candidate.env);
      if (result.ok) {
        pretextOutputChannel.appendLine(
          `[Instant Preview] Render worker will use ${candidate.label} ${shown}.`,
        );
        nodeLaunch = {
          command: candidate.command,
          flags,
          env: candidate.env,
        };
        return nodeLaunch;
      }
      attempts.push(`${candidate.label} ${shown} -> ${result.detail}`);
    }
  }

  pretextOutputChannel.appendLine(
    `[Instant Preview] No runtime with WebAssembly JSPI found. Attempts:\n  ` +
      attempts.join("\n  "),
  );
  throw new Error(
    `The live preview needs a Node.js runtime with WebAssembly JSPI, and none ` +
      `of the ${attempts.length} runtime/flag combinations tried provided one. ` +
      `See the PreTeXt output log for what each attempt reported. Updating VS ` +
      `Code is usually the easiest fix, since it supplies the runtime this ` +
      `preview prefers. Otherwise install Node.js 24 or later (Node 22 cannot ` +
      `do this -- its V8 predates the WebAssembly.Suspending API) and, if it ` +
      `is not on PATH, set "pretext-tools.instantPreview.nodePath" to its ` +
      `absolute path (that setting is machine-scoped, so in a remote or ` +
      `Codespaces window set it under the "Remote" tab, not "User").`,
  );
}
