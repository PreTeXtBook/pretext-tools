import * as path from "path";
import { URI } from "vscode-uri";

/** Defaults applied by the `pretext` CLI when a `project.ptx` manifest omits them. */
const DEFAULT_SOURCE_DIR = "source";
const DEFAULT_TARGET_SOURCE = "main.ptx";
/** Bound on how far up the directory tree to search for a `project.ptx`. */
const MAX_UPWARD_SEARCH = 32;

const VERSION_2_RE = /<project\s[^>]*?\bptx-version\s*=\s*("|')2\1/;
const PROJECT_SOURCE_RE = /<project\b[^>]*?\bsource\s*=\s*("|')(.*?)\1/;
const TARGET_TAG_RE = /<target\b[^>]*?\/?>/g;
const TARGET_SOURCE_RE = /\bsource\s*=\s*("|')(.*?)\1/;
/** Legacy (v1) manifests declare their single main file as a child element. */
const LEGACY_SOURCE_RE = /<source>(.*?)<\/source>/;

export type ReadFile = (absolutePath: string) => string | undefined;

/**
 * Resolve the absolute paths to every distinct target `source` file declared
 * in a `project.ptx` manifest, applying the same defaults as the `pretext`
 * CLI. Handles both manifest formats:
 *  - v2 (`ptx-version="2"`): the project-level `source` *attribute* (default
 *    `"source"`) is the base directory, and each target's `source` attribute
 *    (default `"main.ptx"`) is resolved within it.
 *  - legacy v1 (no `ptx-version`): a single main file is declared via a
 *    `<source>` *element*, resolved directly against the project root (no
 *    subdirectory default).
 */
function resolveManifestSourcePaths(
  manifest: string,
  projectRoot: string,
): string[] {
  if (!VERSION_2_RE.test(manifest)) {
    const legacyMatch = LEGACY_SOURCE_RE.exec(manifest);
    const relSource = legacyMatch ? legacyMatch[1] : DEFAULT_TARGET_SOURCE;
    return [path.resolve(projectRoot, relSource)];
  }

  const projectSourceMatch = PROJECT_SOURCE_RE.exec(manifest);
  const sourceDir = projectSourceMatch
    ? projectSourceMatch[2]
    : DEFAULT_SOURCE_DIR;

  const paths = new Set<string>();
  for (const tag of manifest.match(TARGET_TAG_RE) ?? []) {
    const sourceMatch = TARGET_SOURCE_RE.exec(tag);
    const relSource = sourceMatch ? sourceMatch[2] : DEFAULT_TARGET_SOURCE;
    paths.add(path.resolve(projectRoot, sourceDir, relSource));
  }
  if (paths.size === 0) {
    paths.add(path.resolve(projectRoot, sourceDir, DEFAULT_TARGET_SOURCE));
  }
  return [...paths];
}

/**
 * Find the absolute paths to every build target's source file declared in
 * the nearest `project.ptx` above a document, by walking upward from its
 * directory. This is the piece of project-manifest knowledge
 * `@pretextbook/schema` deliberately doesn't have — it validates whatever
 * `rootDocuments` it's given (defaulting to a sibling `main.ptx` when none
 * are supplied), and it's this extension's job, as the calling app, to
 * resolve them from `project.ptx` when one exists.
 *
 * Returns `undefined` when no manifest is found above the document (the
 * schema package's own `main.ptx`-next-to-the-document default then applies).
 */
export function findProjectRootDocuments(
  documentUri: string,
  readFile: ReadFile,
): string[] | undefined {
  let dir = path.dirname(URI.parse(documentUri).fsPath);
  for (let i = 0; i < MAX_UPWARD_SEARCH; i++) {
    const manifest = readFile(path.join(dir, "project.ptx"));
    if (manifest !== undefined) {
      return resolveManifestSourcePaths(manifest, dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
  return undefined;
}
