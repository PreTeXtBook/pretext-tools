/**
 * Platform seam: everything in this package that touches the outside world.
 *
 * The renderer needs exactly three things from its host: read a file under a
 * mounted directory (the XSL tree), read a file the caller named by path (the
 * source, publication, docinfo), and know where this package's `assets/`
 * directory is. Under Node all three are filesystem operations. In a browser
 * they are `fetch`es. Confining them here is what lets the same renderer run
 * in both — see host.browser.ts for the counterpart, swapped in at build time
 * by vite.config.ts.
 *
 * Every read returns `undefined` rather than throwing when the target is
 * missing. Callers turn that into their own domain behaviour (mounts.ts
 * serves MISSING_FILE_STUB, xinclude.ts looks for an <xi:fallback>).
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read `relPath` (posix, leading "/") beneath mount root `root`. Refuses to
 * escape the mount: a `..` that climbs above `root` reads nothing.
 */
export async function readMount(
  root: string,
  relPath: string,
): Promise<Uint8Array | undefined> {
  const base = path.resolve(root);
  const filePath = path.resolve(base, `.${path.posix.normalize(relPath)}`);
  if (filePath !== base && !filePath.startsWith(base + path.sep)) {
    console.error(
      `pretext-html: refusing to serve ${relPath} from outside ${base}`,
    );
    return undefined;
  }
  try {
    return new Uint8Array(await readFile(filePath));
  } catch {
    return undefined;
  }
}

/** Read a caller-named file (source, publication, docinfo, xi:include). */
export async function readSource(
  location: string,
): Promise<string | undefined> {
  try {
    return await readFile(location, "utf8");
  } catch {
    return undefined;
  }
}

let assetsBaseOverride: string | undefined;

/**
 * Serve this package's `assets/` from somewhere other than its own directory
 * — the programmatic equivalent of the `PRETEXT_HTML_ASSETS` environment
 * variable, which it takes precedence over. Must be called before the first
 * render; the compiled stylesheet is cached per root.
 */
export function setAssetsBase(base: string): void {
  assetsBaseOverride = base;
}

/**
 * This package's `assets/` directory.
 *
 * Computed with path functions rather than `new URL(..., import.meta.url)` so
 * vite's asset handling does not inline the file at build time. Works from
 * both src/ and dist/, which sit at the same depth in the package. The
 * overrides serve bundlers (the VS Code extension bundles this module and
 * ships the assets elsewhere).
 */
export function assetsBase(): string {
  return (
    assetsBaseOverride ??
    process.env["PRETEXT_HTML_ASSETS"] ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets")
  );
}

/** Join a child onto an assets-style root. */
export function joinPath(root: string, child: string): string {
  return path.join(root, child);
}
