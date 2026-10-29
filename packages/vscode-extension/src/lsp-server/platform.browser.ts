/**
 * Browser (Web Worker) counterpart of platform.ts, swapped in by the web
 * server bundle. No filesystem: every file the server needs — project sources,
 * schema assets — arrives from the client (see project-files.ts, assets.ts).
 */
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  Connection,
  createConnection,
} from "vscode-languageserver/browser";

// The worker's global scope; the extension's tsconfig targets Node, so it is
// not in the ambient types.
declare const self: unknown;

/** Create the server's connection to the client over the worker's port. */
export function createServerConnection(): Connection {
  const scope = self as ConstructorParameters<typeof BrowserMessageReader>[0];
  return createConnection(
    new BrowserMessageReader(scope),
    new BrowserMessageWriter(scope),
  );
}

export function readLocalFile(_absolutePath: string): string | undefined {
  return undefined;
}

export function defaultAssetsUri(): string | undefined {
  return undefined;
}
