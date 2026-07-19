import * as path from "path";
import { URI } from "vscode-uri";
import { resolveRootSourcesFromManifest } from "../../project-manifest";

/** Bound on how far up the directory tree to search for a `project.ptx`. */
const MAX_UPWARD_SEARCH = 32;

export type ReadFile = (absolutePath: string) => string | undefined;

/**
 * Find the absolute paths to every build target's source file declared in the
 * nearest `project.ptx` above a document, by walking upward from its directory.
 * This is the piece of project-manifest knowledge `@pretextbook/schema`
 * deliberately doesn't have — it validates whatever `rootDocuments` it's given
 * (defaulting to a sibling `main.ptx` when none are supplied), and it's this
 * extension's job, as the calling app, to resolve them from `project.ptx` when
 * one exists.
 *
 * Manifest parsing is delegated to `resolveRootSourcesFromManifest` — the same
 * `xml2js`-based resolver the extension-host outline uses — so validation and
 * the outline can never disagree on where a project's book root lives.
 *
 * Returns `undefined` when no manifest is found above the document (the schema
 * package's own `main.ptx`-next-to-the-document default then applies).
 */
export function findProjectRootDocuments(
  documentUri: string,
  readFile: ReadFile,
): string[] | undefined {
  let dir = path.dirname(URI.parse(documentUri).fsPath);
  for (let i = 0; i < MAX_UPWARD_SEARCH; i++) {
    const manifest = readFile(path.join(dir, "project.ptx"));
    if (manifest !== undefined) {
      return resolveRootSourcesFromManifest(manifest, dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
  return undefined;
}
