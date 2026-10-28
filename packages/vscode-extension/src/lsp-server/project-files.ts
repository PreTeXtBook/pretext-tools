import type { FileReader } from "@pretextbook/schema";
import { URI } from "vscode-uri";
import { documents } from "./state";
import { readLocalFile } from "./platform";

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
 */

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

/*
 * Path space.
 *
 * `@pretextbook/schema`, `@pretextbook/completions` and the manifest resolver
 * all think in absolute paths and `file:` URIs. A `file:` document maps to its
 * ordinary filesystem path. A document under any other scheme — `vscode-vfs:`
 * on github.dev, for instance — maps to a virtual absolute path that encodes
 * the scheme and authority, so relative `xi:include` hrefs resolve with plain
 * path arithmetic and the result maps back to the right URI.
 */

const VFS_PREFIX = "/__vfs__/";

export function uriToPath(uri: string): string {
  const parsed = URI.parse(uri);
  if (parsed.scheme === "file") {
    return parsed.fsPath;
  }
  return `${VFS_PREFIX}${parsed.scheme}/${parsed.authority}${parsed.path}`;
}

export function pathToUri(absolutePath: string): string {
  // Node's win32 `path.resolve` prefixes a virtual path with the current
  // drive; a virtual path never has one, so strip it before looking.
  const posix = absolutePath
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:(?=\/__vfs__\/)/, "");
  if (posix.startsWith(VFS_PREFIX)) {
    const [scheme, authority, ...segments] = posix
      .slice(VFS_PREFIX.length)
      .split("/");
    return URI.from({
      scheme,
      authority,
      path: `/${segments.join("/")}`,
    }).toString();
  }
  return URI.file(absolutePath).toString();
}

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
