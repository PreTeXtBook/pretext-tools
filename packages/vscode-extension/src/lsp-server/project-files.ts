import type { FileReader } from "@pretextbook/schema";
import { URI } from "vscode-uri";
import { documents } from "./state";
import { readLocalFile } from "./platform";
import { pathToUri, uriToPath, VFS_PREFIX } from "../virtual-path";

/**
 * The project's files as the server knows them, without a filesystem.
 *
 * The client pushes a snapshot of the workspace's PreTeXt sources at startup
 * (`pretext/projectFiles`) and keeps it current from its file watchers
 * (`pretext/projectFileChanged`). Everything that used to read the disk —
 * collecting `xml:id`s across `xi:include`s, finding the nearest
 * `project.ptx`, resolving includes during validation — reads from here, so
 * the same server runs in a Web Worker, where there is no disk at all.
 *
 * Reads prefer the live text of an open document, then the snapshot, then
 * (Node host only) the local filesystem for anything the snapshot missed.
 *
 * Paths are in the space `virtual-path.ts` defines (re-exported here for the
 * server's other modules): real filesystem paths for `file:` documents,
 * virtual absolute paths for everything else.
 */

export { pathToUri, uriToPath };

/** One file the client told us about. `text` is absent for files only listed by name. */
export interface ProjectFileEntry {
  uri: string;
  text?: string;
}

const files = new Map<string, string | undefined>();

export function replaceProjectFiles(entries: ProjectFileEntry[]): void {
  files.clear();
  for (const entry of entries) {
    files.set(entry.uri, entry.text);
  }
}

/** Apply one watcher event. `deleted` drops the file; otherwise it is upserted. */
export function updateProjectFile(
  uri: string,
  change: { text?: string; deleted?: boolean },
): void {
  if (change.deleted) {
    files.delete(uri);
  } else {
    files.set(uri, change.text);
  }
}

export function projectFileUris(): string[] {
  return [...files.keys()];
}

/** The snapshot's files as paths in the space {@link uriToPath} defines. */
export function projectFilePaths(): string[] {
  return projectFileUris().map(uriToPath);
}

/** Text of a project file by URI, or `undefined` if unknown/unreadable. */
export function readProjectText(uri: string): string | undefined {
  const open = documents.get(uri);
  if (open) {
    return open.getText();
  }
  const snapshot = files.get(uri);
  if (snapshot !== undefined) {
    return snapshot;
  }
  const parsed = URI.parse(uri);
  if (parsed.scheme === "file") {
    return readLocalFile(parsed.fsPath);
  }
  return undefined;
}

/** {@link readProjectText} keyed by path, in the shape `@pretextbook/schema` wants. */
export const readProjectFile: FileReader = (absolutePath) =>
  readProjectText(pathToUri(absolutePath));

/**
 * The document identifier to hand `@pretextbook/schema`: `file:` documents
 * pass through as URIs; anything else is given as its bare virtual path,
 * which the package passes straight to its path arithmetic. (Not a `file:`
 * URI of that path: Node's `fileURLToPath` rejects one with no drive letter
 * on Windows.)
 */
export function toSchemaUri(uri: string): string {
  return URI.parse(uri).scheme === "file" ? uri : uriToPath(uri);
}

/**
 * Undo {@link toSchemaUri} on an identifier the schema package reports: the
 * one it was given for the document, or a `file:` URI it built from the path
 * of an included file (possibly with a drive letter, see {@link pathToUri}).
 */
export function fromSchemaUri(uri: string): string {
  const parsed = URI.parse(uri);
  if (parsed.scheme === "file") {
    const path = parsed.path.replace(/^\/[A-Za-z]:(?=\/__vfs__\/)/, "");
    if (path.startsWith(VFS_PREFIX)) {
      return pathToUri(path);
    }
  }
  return uri;
}
