// Decides what an *existing* PreTeXt project keeps when it is imported.
//
// The pipeline rewrites the document itself: the target's source is expanded,
// re-split into divisions, and written back out. Everything else the author
// had — their publication file, images, custom XSL, `.bib` files, the odd
// `requirements.txt` — is theirs, and is copied through untouched at its
// original project-relative path, so `<image source="…"/>` and
// `<directories external="…"/>` keep resolving exactly as they did.
//
// The exceptions are narrow and deliberate: files the import consumed (they
// come back as rewritten source), the manifest (regenerated to match the new
// layout), and build output (a stale `output/` is noise, not content).

import type { ManifestTarget, ProjectManifest } from "./manifest";
import { relativeToDirectory } from "./paths";

/** Directories that hold build output or tooling state, never source. */
const IGNORED_DIRECTORIES = [
  "output",
  ".git",
  ".github/workflows/.cache",
  "node_modules",
  ".ptx",
  "__pycache__",
  ".venv",
  "__MACOSX",
];

export interface CarryOverOptions {
  manifest: ProjectManifest;
  /** The target the import followed. */
  target: ManifestTarget;
  /** All uploaded text files, keyed by archive path. */
  files: Record<string, string>;
  /** All uploaded binaries, keyed by archive path. */
  assets: Record<string, Uint8Array>;
  /** Archive paths whose content was folded into the imported document. */
  consumedPaths: Iterable<string>;
}

export interface CarryOverResult {
  /** Text files to write, keyed by project-relative path. */
  files: Record<string, string>;
  /** Binaries to write, keyed by project-relative path. */
  assets: Record<string, Uint8Array>;
  /** Project-relative paths that were deliberately not carried over. */
  skipped: string[];
}

function isIgnored(projectRelativePath: string, outputDirs: string[]): boolean {
  const lower = projectRelativePath.toLowerCase();
  return [...IGNORED_DIRECTORIES, ...outputDirs].some(
    (dir) => dir.length > 0 && lower.startsWith(`${dir.toLowerCase()}/`),
  );
}

/**
 * Split an existing project's uploaded files into "copy through" and
 * "deliberately dropped". Paths on the result are relative to the project root
 * (the directory holding `project.ptx`), so an archive that nests everything
 * under `my-book-main/` imports as a project, not as a folder containing one.
 */
export function carryOverProjectFiles(
  options: CarryOverOptions,
): CarryOverResult {
  const { manifest, files, assets } = options;
  const root = manifest.projectRoot;
  const consumed = new Set(options.consumedPaths);
  const outputDirs = [
    ...new Set(
      manifest.targets
        .map((target) => target.outputDir?.split("/")[0])
        .filter((dir): dir is string => !!dir),
    ),
  ];

  const result: CarryOverResult = { files: {}, assets: {}, skipped: [] };

  const consider = (
    archivePath: string,
    keep: (projectRelativePath: string) => void,
  ): void => {
    // Anything outside the project root belongs to some other project (or is
    // archive packaging); it is not ours to write.
    if (root && !archivePath.startsWith(`${root}/`)) {
      return;
    }
    const relative = relativeToDirectory(root, archivePath);
    if (consumed.has(archivePath) || archivePath === manifest.manifestPath) {
      return;
    }
    if (isIgnored(relative, outputDirs)) {
      result.skipped.push(relative);
      return;
    }
    keep(relative);
  };

  for (const [archivePath, contents] of Object.entries(files)) {
    consider(archivePath, (relative) => {
      result.files[relative] = contents;
    });
  }
  for (const [archivePath, bytes] of Object.entries(assets)) {
    consider(archivePath, (relative) => {
      result.assets[relative] = bytes;
    });
  }

  return result;
}

/**
 * Regenerate `project.ptx` for an imported project, preserving the original
 * targets (their names, formats, and output directories) while pointing the
 * imported target at the layout we actually wrote.
 *
 * Targets are emitted in the v2 child-element form, whose paths are relative
 * to the project root — the same form `renderProjectPtx` uses for brand-new
 * projects, so every project this package produces reads the same way.
 */
export function renderProjectPtxFromManifest(
  manifest: ProjectManifest,
  importedTarget: ManifestTarget,
  layout: { mainSource: string; publication?: string },
): string {
  const targets = manifest.targets.map((target) => {
    const isImported = target.source === importedTarget.source;
    const source = isImported ? layout.mainSource : target.source;
    const publication = isImported
      ? (layout.publication ?? target.publication)
      : target.publication;

    const lines = [
      `    <target name="${target.name}"${target.standalone ? ' standalone="yes"' : ""}>`,
      target.format ? `      <format>${target.format}</format>` : "",
      `      <source>${source}</source>`,
      publication ? `      <publication>${publication}</publication>` : "",
      target.outputDir
        ? `      <output-dir>${target.outputDir}</output-dir>`
        : "",
      "    </target>",
    ];
    return lines.filter(Boolean).join("\n");
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<project ptx-version="2">
  <targets>
${targets.join("\n")}
  </targets>
</project>
`;
}
