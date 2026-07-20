/**
 * Virtual-host fetch shim.
 *
 * The libxslt-wasm build is compiled with FILESYSTEM=0, so libxml2 cannot
 * touch the real filesystem: any `file://` URL aborts inside the WASM sandbox.
 * Instead, every external resource load (stylesheet imports, DTD entities,
 * xi:includes, the publication file, `document()` calls) is routed through the
 * *global* `fetch` via a JSPI-suspended import. That makes resource loading
 * fully controllable from JavaScript: we register fake hosts under the
 * reserved `.invalid` TLD and serve them from local directories or in-memory
 * strings. No HTTP server, no real network traffic.
 */

import { readMount as defaultReadMount } from "./host.js";

/**
 * Reads `relPath` (posix, leading "/") beneath mount root `root`, or resolves
 * `undefined` when it is missing or escapes the mount. `root` is opaque: a
 * directory under Node, a base URL in a browser, whatever an embedder's own
 * reader wants.
 */
export type MountReader = (
  root: string,
  relPath: string,
) => Promise<Uint8Array | string | undefined>;

const directoryMounts = new Map<string, string>();
const virtualFiles = new Map<string, string>();
let realFetch: typeof globalThis.fetch | undefined;
let mountCounter = 0;
let mountReader: MountReader = defaultReadMount;

/**
 * Replace how mounted files are read. Lets an embedder serve the stylesheets
 * from somewhere the platform seam does not cover — an in-memory map, a zip,
 * a VS Code webview resource URI — without patching `globalThis.fetch`.
 * Also how scripts/build-xsl-bundle.mjs records which files a render touches.
 */
export function setMountReader(reader: MountReader): void {
  mountReader = reader;
}

function shimFetch(
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  const virtual = virtualFiles.get(url);
  if (virtual !== undefined) {
    return Promise.resolve(new Response(virtual, { status: 200 }));
  }

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  const dir = directoryMounts.get(host);
  if (dir !== undefined) {
    return serveFromDirectory(dir, url);
  }

  // Anything else (e.g. a source that pulls a resource from the real web)
  // falls through to the real fetch.
  return realFetch!(input, init);
}

/**
 * Served for files that are missing (or outside) a mount. A fetch *failure*
 * must never reach the WASM side: its entity loader would return NULL and
 * libxml2 would fall back to real-filesystem input callbacks, which abort
 * under the FILESYSTEM=0 build. A well-formed do-nothing document instead
 * makes `document()` lookups on missing generated assets (svg dimensions,
 * asymptote metadata, ...) degrade the way the stylesheets already handle.
 */
const MISSING_FILE_STUB = `<?xml version="1.0"?><pretext-preview-missing-file/>`;

async function serveFromDirectory(dir: string, url: string): Promise<Response> {
  const pathname = decodeURIComponent(new URL(url).pathname);
  // Containment is the reader's job: only it knows what `dir` means. Both
  // shipped readers refuse to escape the mount and return undefined.
  const data = await mountReader(dir, pathname);
  if (data === undefined) {
    return new Response(MISSING_FILE_STUB, { status: 200 });
  }
  // Re-wrap bytes so the body type is a Uint8Array over a plain ArrayBuffer,
  // which is what BodyInit accepts.
  const body = typeof data === "string" ? data : new Uint8Array(data);
  return new Response(body, { status: 200 });
}

/** Install the shim (idempotent). Must run before libxslt-wasm loads anything. */
export function installFetchShim(): void {
  if (realFetch) {
    return;
  }
  realFetch = globalThis.fetch;
  globalThis.fetch = shimFetch as typeof globalThis.fetch;
}

/**
 * Serve `dir` under a unique fake origin. Returns the base URL
 * (e.g. `http://mnt1.ptx.invalid`); resource paths append to it.
 *
 * `dir` is stored verbatim and handed back to the {@link MountReader}, which
 * owns its interpretation — under Node a directory path, in a browser a base
 * URL.
 */
export function mountDirectory(dir: string): string {
  installFetchShim();
  const host = `mnt${++mountCounter}.ptx.invalid`;
  directoryMounts.set(host, dir);
  return `http://${host}`;
}

export function unmountDirectory(baseUrl: string): void {
  directoryMounts.delete(new URL(baseUrl).host);
}

/** Serve `content` for exactly `url`. Takes priority over directory mounts. */
export function setVirtualFile(url: string, content: string): void {
  installFetchShim();
  virtualFiles.set(url, content);
}

export function removeVirtualFile(url: string): void {
  virtualFiles.delete(url);
}
