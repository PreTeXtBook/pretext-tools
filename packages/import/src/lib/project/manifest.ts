// Reads a PreTeXt project manifest (`project.ptx`) so an import can start
// from the same root document the `pretext` CLI would build.
//
// This deliberately re-implements the resolution rules that
// `packages/vscode-extension/src/project-manifest.ts` applies, rather than
// importing them: that module runs on `xml2js` + `node:path`, and the import
// pipeline must also run in a browser. The *rules* are the contract and must
// stay in sync:
//
//   - a `<source>` **child element** holds a path relative to the project root
//     (it usually already includes the `source/` directory);
//   - a `source` **attribute** holds a path relative to the project's source
//     directory (the project-level `source` attribute, default `"source"`);
//   - with neither, a target defaults to `<sourceDir>/main.ptx`.
//
// Publication files follow the same split against the project-level
// `publication` directory (default `"publication"`).

import {
  findFirstElement,
  findTopLevelElements,
  type XmlElementSpan,
} from "../layout/xml-scan";
import { basename, dirname, joinPath, normalizePath } from "./paths";

/** Default source directory the CLI assumes when a manifest omits it. */
const DEFAULT_SOURCE_DIR = "source";
/** Default publication directory the CLI assumes when a manifest omits it. */
const DEFAULT_PUBLICATION_DIR = "publication";
/** Default source file name a target assumes when it declares none. */
const DEFAULT_TARGET_SOURCE = "main.ptx";

export interface ManifestTarget {
  name: string;
  /** `html`, `pdf`, `latex`, … — `""` when the manifest declares none. */
  format: string;
  /** Project-root-relative path to the target's main source file. */
  source: string;
  /** Project-root-relative path to the target's publication file, if any. */
  publication?: string;
  /** Project-root-relative output directory, if declared. */
  outputDir?: string;
  /** A `standalone` attribute that is present and not `"no"`. */
  standalone: boolean;
}

export interface ProjectManifest {
  /** Path of the `project.ptx` file within the uploaded file set. */
  manifestPath: string;
  /** Directory the manifest lives in — the project root ("" at top level). */
  projectRoot: string;
  /** The `ptx-version` attribute, when present. */
  ptxVersion?: string;
  /** Project-level source directory (default `source`). */
  sourceDir: string;
  /** Project-level publication directory (default `publication`). */
  publicationDir: string;
  targets: ManifestTarget[];
}

/**
 * Text of a child element of `parent`, or `undefined` when it has none. Only
 * direct children count, so a `<source>` nested inside some other child never
 * shadows the target's own.
 */
function childText(parent: XmlElementSpan, name: string): string | undefined {
  const child = findFirstElement(parent.inner, name);
  if (!child) {
    return undefined;
  }
  const text = child.inner.trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Resolve a target path that may be given either as a child element (relative
 * to the project root) or as an attribute (relative to `attributeBase`).
 */
function resolveTargetPath(
  target: XmlElementSpan,
  name: string,
  attributeBase: string,
): string | undefined {
  const child = childText(target, name);
  if (child !== undefined) {
    return normalizePath(child);
  }
  const attr = target.attributes[name];
  if (attr !== undefined && attr.trim().length > 0) {
    return joinPath(attributeBase, attr.trim());
  }
  return undefined;
}

/**
 * Parse a `project.ptx` manifest. `manifestPath` is the file's path within the
 * uploaded file set; every path on the result is relative to the manifest's
 * own directory (the project root), so callers can join it back onto the
 * upload's paths.
 *
 * Returns `null` when the text has no `<project>` root — a `project.ptx` that
 * is really something else should not hijack the import.
 */
export function parseProjectManifest(
  contents: string,
  manifestPath: string,
): ProjectManifest | null {
  const projectSpan = findFirstElement(contents, "project");
  if (!projectSpan) {
    return null;
  }

  const projectRoot = dirname(normalizePath(manifestPath));
  const sourceDir =
    projectSpan.attributes["source"]?.trim() || DEFAULT_SOURCE_DIR;
  const publicationDir =
    projectSpan.attributes["publication"]?.trim() || DEFAULT_PUBLICATION_DIR;
  const outputDir = projectSpan.attributes["output"]?.trim() || "output";

  const manifest: ProjectManifest = {
    manifestPath: normalizePath(manifestPath),
    projectRoot,
    ptxVersion: projectSpan.attributes["ptx-version"],
    sourceDir,
    publicationDir,
    targets: [],
  };

  const targetsSpan = findFirstElement(projectSpan.inner, "targets");
  const targetSpans = targetsSpan
    ? findTopLevelElements(targetsSpan.inner, "target")
    : [];

  for (const target of targetSpans) {
    manifest.targets.push({
      name: target.attributes["name"] ?? "",
      // v2 manifests carry the format as an attribute; legacy v1 manifests
      // use a `<format>` child element.
      format: target.attributes["format"] ?? childText(target, "format") ?? "",
      source:
        resolveTargetPath(target, "source", sourceDir) ??
        joinPath(sourceDir, DEFAULT_TARGET_SOURCE),
      publication: resolveTargetPath(target, "publication", publicationDir),
      outputDir: resolveTargetPath(target, "output-dir", outputDir),
      standalone:
        target.attributes["standalone"] !== undefined &&
        target.attributes["standalone"] !== "no",
    });
  }

  if (manifest.targets.length === 0) {
    // Very old manifests: a single project-level `<source>` element and no
    // `<targets>` at all, resolved directly against the project root.
    const legacySource = childText(projectSpan, "source");
    manifest.targets.push({
      name: "default",
      format: childText(projectSpan, "format") ?? "",
      source: legacySource
        ? normalizePath(legacySource)
        : joinPath(sourceDir, DEFAULT_TARGET_SOURCE),
      publication: childText(projectSpan, "publication"),
      standalone: false,
    });
  }

  return manifest;
}

/**
 * Find the `project.ptx` governing an uploaded file set: the shallowest one
 * that really has a `<project>` root. Archives commonly nest everything under
 * a single directory (`my-book-main/`), so depth — not alphabetical order —
 * decides.
 */
export function findProjectManifest(
  files: Record<string, string>,
): ProjectManifest | null {
  const candidates = Object.keys(files)
    .filter((p) => basename(p).toLowerCase() === "project.ptx")
    .sort((a, b) => {
      const depth = a.split("/").length - b.split("/").length;
      return depth !== 0 ? depth : a.localeCompare(b);
    });

  for (const candidate of candidates) {
    const manifest = parseProjectManifest(files[candidate], candidate);
    if (manifest) {
      return manifest;
    }
  }
  return null;
}

/**
 * The target an import should follow by default. The CLI builds the first
 * declared target when none is named, so that is the default here too —
 * except that `standalone` targets (single-division previews) are skipped
 * while a non-standalone one exists.
 */
export function defaultManifestTarget(
  manifest: ProjectManifest,
): ManifestTarget | undefined {
  return (
    manifest.targets.find((target) => !target.standalone) ?? manifest.targets[0]
  );
}
