/**
 * Platform seam: the handful of Node built-ins that URI/path resolution
 * (book.ts, xinclude.ts) and the default file reader depend on. See
 * platform.browser.ts for the posix-only, fs-free counterpart substituted in
 * at build time for the "browser" export condition (vite.config.mts, mode
 * "browser") — keeping this module's own imports static (rather than a lazy
 * `require`) is what lets the browser build simply never include it.
 */
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath as nodeFileURLToPath } from "node:url";
import { pathToFileURL as nodePathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

export { dirname, isAbsolute, resolve };

export const fileURLToPath = nodeFileURLToPath;

export function pathToFileURL(path: string): string {
  return nodePathToFileURL(path).toString();
}

/** Read a file from disk; `undefined` when it can't be read. */
export function readFileUtf8(absolutePath: string): string | undefined {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}
