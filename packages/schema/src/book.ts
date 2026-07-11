import * as path from "path";
import { fileURLToPath } from "url";
import type { FileReader } from "./types";

/** Used when a caller doesn't know (or care) how to locate the project's root document(s). */
const DEFAULT_ROOT_DOCUMENTS = ["main.ptx"];

const XML_ID_RE = /\bxml:id\s*=\s*("|')(.*?)\1/g;
const LABEL_RE = /\blabel\s*=\s*("|')(.*?)\1/g;
const XINCLUDE_HREF_RE = /<xi:include\b[^>]*?\bhref\s*=\s*("|')(.*?)\1[^>]*?\/>/g;

export function uriToPath(uri: string): string {
  return uri.startsWith("file:") ? fileURLToPath(uri) : uri;
}

/**
 * `xml:id`s and `label`s declared across a book, each mapped to the absolute
 * paths of every file that declares it (so callers can tell whether a value
 * is duplicated *outside* a given file, not just whether it exists).
 */
export interface BookReferences {
  ids: Map<string, Set<string>>;
  labels: Map<string, Set<string>>;
}

function addRef(map: Map<string, Set<string>>, key: string, file: string): void {
  let files = map.get(key);
  if (!files) {
    files = new Set();
    map.set(key, files);
  }
  files.add(file);
}

/** Recursively collect ids/labels from a file and everything it `xi:include`s. */
function collectFromFile(
  absolutePath: string,
  readFile: FileReader,
  visited: Set<string>,
  refs: BookReferences,
): boolean {
  if (visited.has(absolutePath)) {
    return true;
  }
  visited.add(absolutePath);
  const text = readFile(absolutePath);
  if (text === undefined) {
    return false;
  }
  for (const m of text.matchAll(XML_ID_RE)) {
    addRef(refs.ids, m[2], absolutePath);
  }
  for (const m of text.matchAll(LABEL_RE)) {
    addRef(refs.labels, m[2], absolutePath);
  }
  const baseDir = path.dirname(absolutePath);
  for (const m of text.matchAll(XINCLUDE_HREF_RE)) {
    collectFromFile(path.resolve(baseDir, m[2]), readFile, visited, refs);
  }
  return true;
}

/**
 * Collect every `xml:id` and `label` declared across a book: starting from
 * each of `rootDocuments` (resolved relative to `documentUri`'s directory
 * when not already absolute; defaults to `["main.ptx"]` when omitted) and
 * following all `xi:include`s from there. This lets validation resolve
 * `xref`/`fragref` targets, and detect duplicate ids/labels, that live
 * outside the currently-validated document's own xi:include chain (e.g. in a
 * sibling chapter also included by the book's root).
 *
 * Deliberately has no knowledge of `project.ptx` or any other manifest
 * format: it's the caller's job (the VS Code extension's LSP, or other
 * PreTeXt tooling) to resolve the project's actual root document(s) and pass
 * them in via `rootDocuments`. Returns `undefined` when none of the root
 * documents can be read (e.g. an isolated fragment with no `main.ptx`
 * sibling and no caller-supplied roots).
 */
export function collectBookReferences(
  documentUri: string,
  readFile: FileReader,
  rootDocuments?: string[],
): BookReferences | undefined {
  const roots = rootDocuments ?? DEFAULT_ROOT_DOCUMENTS;
  if (roots.length === 0) {
    return undefined;
  }
  const baseDir = path.dirname(uriToPath(documentUri));
  const refs: BookReferences = { ids: new Map(), labels: new Map() };
  const visited = new Set<string>();
  let foundAny = false;
  for (const root of roots) {
    const rootPath = uriToPath(root);
    const absolute = path.isAbsolute(rootPath)
      ? rootPath
      : path.resolve(baseDir, rootPath);
    if (collectFromFile(absolute, readFile, visited, refs)) {
      foundAny = true;
    }
  }
  return foundAny ? refs : undefined;
}
