import { URI } from "vscode-uri";
import { defaultAssetsUri, readLocalFile } from "./platform";

/**
 * The server's bundled assets (RELAX NG schemas, precompiled grammars) and
 * any other file it needs by URI, read through the client.
 *
 * The client says where the assets are in `initializationOptions.assetsUri`
 * and answers `pretext/readFile` requests with `workspace.fs`, which works on
 * every host. The Node server short-circuits `file:` URIs to a local read,
 * and falls back to the assets next to its bundle when the client said
 * nothing (older clients, tests).
 */

let assetsBase: string | undefined;

export function setAssetsUri(uri: string | undefined): void {
  assetsBase = uri;
}

export function getAssetsUri(): string | undefined {
  return assetsBase ?? defaultAssetsUri();
}

/** The URI of a bundled asset by file name. */
export function assetUri(name: string): string {
  const base = assetsBase ?? defaultAssetsUri() ?? "file:///";
  return resolveUri(name, base.endsWith("/") ? base : `${base}/`);
}

/**
 * Resolve `href` against the *directory* of `baseUri` when `baseUri` names a
 * file, or against `baseUri` itself when it ends in `/` — the same rule RNG
 * `<include href>` and `xi:include` follow.
 */
export function resolveUri(href: string, baseUri: string): string {
  return new URL(href, baseUri).toString();
}

/** Read a file by URI; `undefined` when it does not exist or cannot be read. */
export async function readUri(uri: string): Promise<string | undefined> {
  const parsed = URI.parse(uri);
  if (parsed.scheme === "file") {
    const local = readLocalFile(parsed.fsPath);
    if (local !== undefined) {
      return local;
    }
  }
  try {
    // Imported lazily so that merely importing this module (as the unit tests
    // do, via validation.ts) does not create the LSP connection as a side
    // effect; the running server already creates it eagerly via main.ts.
    const { connection } = await import("./connection");
    const result = await connection.sendRequest<string | null>(
      "pretext/readFile",
      { uri },
    );
    return result ?? undefined;
  } catch (error) {
    console.warn(`Could not read ${uri} through the client:`, error);
    return undefined;
  }
}

export function readAsset(name: string): Promise<string | undefined> {
  return readUri(assetUri(name));
}
