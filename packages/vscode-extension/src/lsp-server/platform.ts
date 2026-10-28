/**
 * Platform seam for the language server: the handful of things that differ
 * between the Node host (a forked process talking over IPC, with a local
 * filesystem) and the browser host (a Web Worker talking over postMessage,
 * with no filesystem). `platform.browser.ts` is substituted for this module
 * by the web server bundle (see build.mjs); keep the two export lists equal.
 */
import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";
import {
  Connection,
  createConnection,
  ProposedFeatures,
} from "vscode-languageserver/node";

/** Create the server's connection to the client over Node IPC. */
export function createServerConnection(): Connection {
  // Also include all preview / proposed LSP features.
  return createConnection(ProposedFeatures.all);
}

/** Read a local file by absolute path; `undefined` when it cannot be read. */
export function readLocalFile(absolutePath: string): string | undefined {
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Where the bundled schema assets live when the client did not say
 * (`initializationOptions.assetsUri`): next to the server bundle, as a URI.
 */
export function defaultAssetsUri(): string | undefined {
  return URI.file(path.join(__dirname, "..", "assets", "schema")).toString();
}
