/**
 * Entry point for the instant-preview Web Worker (github.dev / vscode.dev).
 *
 * The twin of instant-preview-worker.ts for the browser host: the same
 * renderer (`@pretextbook/pretext-html`, resolved to its browser build),
 * the same protocol and serve loop (preview-protocol.ts), launched by
 * preview-host-browser.ts. Needs WebAssembly JSPI, which the host checks for
 * before launching (Chromium-based browsers only, as of now).
 *
 * There is no filesystem here. Every file the renderer wants — the project's
 * own files for xi:includes, the publication file, the context document; and
 * the extension's bundled stylesheets — is read through the host
 * (`read` / `readResult` messages), which has `workspace.fs`. The
 * WebAssembly binary arrives in the host's `init` message. All of that is
 * preview-worker-bootstrap.ts, which must stay the first import.
 *
 * Bundled by esbuild (see build.mjs) into out/instant-preview-worker.web.js
 * as a *classic* worker script: the renderer's module-level `await` is
 * wrapped in an async IIFE and `import.meta.url` is defined away, because
 * VS Code bootstraps a web extension's nested workers with `importScripts`,
 * which cannot load a module worker.
 */
import {
  ASSETS_ORIGIN,
  onHostMessage,
  postToHost,
  readFromHost,
  workerScope,
} from "./preview-worker-bootstrap";
import * as path from "path";
import {
  renderHtml,
  setAssetsBase,
  setMountReader,
  type SourceReader,
} from "@pretextbook/pretext-html";
import { createRenderServer, isRenderRequest } from "./preview-protocol";

/**
 * Where the renderer is told its `assets/` are: the fake origin the
 * bootstrap's `fetch` wrapper answers from the extension's bundled
 * `assets/pretext-html/` (so a URL's path is an asset's path, as is). The
 * wrapper stylesheet is read that way, since the renderer fetches it through
 * its own platform reader; the mounted stylesheet tree and the project
 * directory come through the mount reader below.
 */
const ASSETS_ROOT = ASSETS_ORIGIN;

function log(line: string): void {
  postToHost({ type: "log", line });
}

/**
 * The extension ships pretext-html's `xsl-bundle.json`, one JSON map of the
 * ~30 stylesheet and localization files a cold render touches, beside the
 * stylesheets themselves. One read in place of thirty; a bundle that is
 * missing or incomplete just falls through to per-file reads.
 */
let xslBundle: Promise<Map<string, string>> | undefined;

function loadXslBundle(): Promise<Map<string, string>> {
  xslBundle ??= readFromHost("asset", "xsl-bundle.json").then((bytes) => {
    if (!bytes) {
      return new Map();
    }
    try {
      const raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<
        string,
        string
      >;
      return new Map(Object.entries(raw));
    } catch {
      return new Map();
    }
  });
  return xslBundle;
}

/**
 * A mount root is either the renderer's assets directory (or its `xsl`
 * subdirectory), which maps onto the extension's bundled copy, or the
 * project directory, which maps onto the workspace. Both refuse to escape
 * their root, like the readers the package ships.
 */
setMountReader(async (root, relPath) => {
  const rel = path.normalize(`/${relPath}`).replace(/^\/+/, "");
  if (rel.startsWith("..")) {
    return undefined;
  }
  if (root === ASSETS_ROOT || root.startsWith(`${ASSETS_ROOT}/`)) {
    const sub = root.slice(ASSETS_ROOT.length).replace(/^\/+/, "");
    if (sub === "xsl") {
      const hit = (await loadXslBundle()).get(rel);
      if (hit !== undefined) {
        return hit;
      }
    }
    return readFromHost("asset", sub ? `${sub}/${rel}` : rel);
  }
  const base = path.resolve(root);
  const file = path.resolve(base, rel);
  if (file !== base && !file.startsWith(`${base}/`)) {
    log(`refusing to serve ${relPath} from outside ${root}`);
    return undefined;
  }
  return readFromHost("project", file);
});

setAssetsBase(ASSETS_ROOT);

/** The project reads the renderer makes by path: includes, publication, … */
const readSource: SourceReader = async (file) => {
  const bytes = await readFromHost("project", file);
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
};

// ── Serve loop ──────────────────────────────────────────────────────────────

const handle = createRenderServer({
  render: (options) => renderHtml({ ...options, readSource }),
  send: postToHost,
  log,
  onFatal: () => {
    // The instance may be corrupted. Tell the host — a worker closing itself
    // is otherwise silent — then go, so the next render gets a fresh one.
    postToHost({ type: "exit", detail: "fatal WebAssembly error" });
    workerScope.close();
  },
});

onHostMessage((message) => {
  if (isRenderRequest(message)) {
    handle(message);
  }
});

log("render worker ready");
