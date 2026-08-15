import JSZip from "jszip";
import { convertSourceToPretext } from "./convert";
import { detectDocumentKind } from "./layout/document-kind";
import { suggestSplitLevel } from "./latex-split";
import { expandTexInputs } from "./clean/latex-includes";
import { expandPretextIncludes } from "./clean/pretext-includes";
import { type BuildProjectFilesOptions } from "./layout";
import { renderPublicationPtx } from "./layout/templates";
import {
  buildDivisionPool,
  buildNativeDivisionPool,
  serializeProjectToFiles,
} from "./pool";
import {
  analyzeImportSources,
  type RootCandidate,
  type UploadAnalysis,
} from "./project/analyze";
import {
  attachLatexRoots,
  attachMarkdownRoots,
  type AttachedRootRecord,
  type RootAttachment,
} from "./project/attach-roots";
import {
  carryOverProjectFiles,
  renderProjectPtxFromManifest,
} from "./project/existing-project";
import type { ManifestTarget, ProjectManifest } from "./project/manifest";
import { basename, extension, normalizePath } from "./project/paths";
import type { CleaningWarning } from "./clean/warnings";
import type { DocumentKind } from "./layout/document-kind";
import type {
  ImportedProject,
  ImportedProjectResult,
  ImportedProjectSuccess,
  ProjectLayout,
  SourceFormat,
  UploadSourceType,
  UploadStatusMessage,
} from "./types";

export interface ImportProjectOptions extends BuildProjectFilesOptions {
  /** When true (default), the layout splitter runs and outputFiles is populated. */
  buildLayout?: boolean;
  /** Raw binary assets keyed by their source path (e.g. images, PDFs). */
  assets?: Record<string, Uint8Array>;
  /**
   * Force the source format, overriding detection — the format dropdown a host
   * shows when an upload contains more than one kind of source.
   */
  sourceFormat?: SourceFormat;
  /** Force which uploaded file is the document root (a path in `files`). */
  mainFile?: string;
  /**
   * How many levels of division to split into separate files/records.
   * Overrides `splitChapters`/`splitSections`; see `resolveSplitLevel`.
   */
  splitLevel?: number;
  /**
   * What to do with roots other than the main one (SPEC §3.3). Defaults to
   * attaching every detected extra root as a division of the main document;
   * pass `false` to import the main file alone, or a list to choose the level,
   * heading, and order per file.
   */
  attachRoots?: RootAttachment[] | false;
  /**
   * For an upload with a `project.ptx`: keep the project's own publication
   * file, assets, and directory layout (default). Set false to import it as
   * loose source into this package's standard layout instead.
   */
  preserveProjectLayout?: boolean;
}

const SUPPORTED_UPLOAD_PATTERN =
  /\.(tex|zip|md|markdown|ptx|xml|tar\.gz|tgz)$/i;

const TRACKED_FILE_TYPES = [
  "tex",
  "md",
  "markdown",
  "ptx",
  "xml",
  "bib",
  "sty",
  "txt",
  "pdf",
  "eps",
  "png",
  "ps",
  "bbl",
] as const;

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "pdf",
  "eps",
  "ps",
  "bmp",
  "tiff",
  "tif",
  "webp",
  "ico",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "bmp",
  "tiff",
  "tif",
  "webp",
  "ico",
  "pdf",
  "eps",
  "ps",
]);

function isBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Where a binary lands in a freshly scaffolded project. Existing projects skip
 * this entirely — their assets keep the paths their source already references.
 */
function routeAssetPath(originalPath: string): string | null {
  const base = basename(originalPath);
  const ext = extension(base);
  if (IMAGE_EXTENSIONS.has(ext)) {
    return `source/assets/${base}`;
  }
  return null;
}

function routeTextAuxiliaryPath(originalPath: string): string | null {
  const base = basename(originalPath);
  const ext = extension(base);
  if (ext === "bib") {
    return `source/${base}`;
  }
  return null;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/(\n *){3,}/g, "\n\n");
}

function getUploadSourceType(fileName: string): UploadSourceType | null {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".tar.gz") || normalized.endsWith(".tgz")) {
    return "tar.gz";
  }
  if (normalized.endsWith(".zip")) {
    return "zip";
  }
  if (normalized.endsWith(".tex")) {
    return "tex";
  }
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) {
    return "markdown";
  }
  if (normalized.endsWith(".ptx") || normalized.endsWith(".xml")) {
    return "pretext";
  }
  return null;
}

function parseTarHeader(headerBytes: Uint8Array): {
  name: string;
  size: number;
  type: string;
} {
  const decode = (start: number, end: number) =>
    new TextDecoder().decode(headerBytes.slice(start, end)).split("\0")[0];

  return {
    name: decode(0, 100),
    size: parseInt(decode(124, 136), 8) || 0,
    type: decode(156, 157),
  };
}

async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This runtime does not support gzip decompression.");
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });

  const decompressedStream = stream.pipeThrough(
    new DecompressionStream("gzip"),
  );
  const reader = decompressedStream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result.buffer;
}

export interface ExtractedUpload {
  files: Record<string, string>;
  assets: Record<string, Uint8Array>;
}

// Why this?
function parseTar(data: Uint8Array): ExtractedUpload {
  const files: Record<string, string> = {};
  const assets: Record<string, Uint8Array> = {};
  let offset = 0;

  while (offset < data.length) {
    if (offset + 512 > data.length) {
      break;
    }

    const headerBytes = data.slice(offset, offset + 512);
    const header = parseTarHeader(headerBytes);
    if (!header.name) {
      break;
    }

    offset += 512;

    const fileSize = header.size;
    const paddedSize = Math.ceil(fileSize / 512) * 512;
    if (header.type === "0" || header.type === "") {
      const fileData = data.slice(offset, offset + fileSize);
      const normalizedPath = normalizePath(header.name);
      if (isBinaryExtension(extension(normalizedPath))) {
        assets[normalizedPath] = fileData;
      } else {
        const content = new TextDecoder().decode(fileData);
        files[normalizedPath] = normalizeText(content);
      }
    }

    offset += paddedSize;
  }

  return { files, assets };
}

/**
 * Unpack an upload into text files and binaries, without converting anything.
 *
 * Exported so a host can run the two-phase flow the pickers need: extract
 * once, `analyzeImportSources` to populate a format dropdown and main-file
 * list, then `importProjectFromFiles` with the user's answers — instead of
 * re-reading and re-unzipping the file for every choice the user changes.
 */
export async function extractUpload(file: File): Promise<ExtractedUpload> {
  const sourceType = getUploadSourceType(file.name);

  if (!sourceType) {
    throw new Error(
      "File format not supported: please upload .tex, .md, .ptx, .xml, .zip, or .tar.gz.",
    );
  }

  if (
    sourceType === "tex" ||
    sourceType === "markdown" ||
    sourceType === "pretext"
  ) {
    const content = await file.text();
    return {
      files: { [normalizePath(file.name)]: normalizeText(content) },
      assets: {},
    };
  }

  if (sourceType === "zip") {
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);
    const files: Record<string, string> = {};
    const assets: Record<string, Uint8Array> = {};

    for (const [entryPath, zipEntry] of Object.entries(contents.files)) {
      if (zipEntry.dir) {
        continue;
      }
      const normalizedPath = normalizePath(entryPath);
      if (isBinaryExtension(extension(normalizedPath))) {
        assets[normalizedPath] = await zipEntry.async("uint8array");
      } else {
        const content = await zipEntry.async("string");
        files[normalizedPath] = normalizeText(content);
      }
    }

    return { files, assets };
  }

  // If not individual file or zip, assume tar.gz
  const buffer = await file.arrayBuffer();
  const decompressed = await decompressGzip(buffer);
  return parseTar(new Uint8Array(decompressed));
}

function getTrackedTypeCounts(
  files: Record<string, string>,
): Record<string, number> {
  const counts: Record<string, number> = { other: 0 };
  for (const type of TRACKED_FILE_TYPES) {
    counts[type] = 0;
  }

  for (const filePath of Object.keys(files)) {
    const ext = extension(filePath);
    if (ext in counts) {
      counts[ext] += 1;
    } else {
      counts["other"] += 1;
    }
  }

  return counts;
}

function appendCountsStatus(
  statusMessages: UploadStatusMessage[],
  files: Record<string, string>,
): void {
  const counts = getTrackedTypeCounts(files);
  statusMessages.push({ type: "success", message: "File types:" });

  for (const key of Object.keys(counts).sort()) {
    if (!counts[key]) {
      continue;
    }
    statusMessages.push({ type: "success", message: `${key}: ${counts[key]}` });
  }
}

function uploadSourceTypeFor(format: SourceFormat): UploadSourceType {
  if (format === "latex") {
    return "tex";
  }
  return format === "markdown" ? "markdown" : "pretext";
}

/** The manifest target whose source is `path`, if any. */
function targetForPath(
  manifest: ProjectManifest,
  projectRelativeSource: string,
): ManifestTarget | undefined {
  return manifest.targets.find(
    (target) => target.source === projectRelativeSource,
  );
}

/**
 * Turn the caller's `attachRoots` option into a concrete list. The default —
 * attach every extra root the analysis found, in the order it found them —
 * lives here so the wizard's checkbox list and a bare API call agree.
 */
function resolveAttachments(
  option: ImportProjectOptions["attachRoots"],
  analysis: UploadAnalysis,
): RootAttachment[] {
  if (option === false) {
    return [];
  }
  if (Array.isArray(option)) {
    return option.filter((attachment) => attachment.include !== false);
  }
  return analysis.extraRoots.map((root) => ({ path: root.path }));
}

/** Human-readable note about which root the import followed and why. */
function describePrimary(primary: RootCandidate): string {
  if (primary.reason === "manifest-target") {
    const target = primary.targetName
      ? ` (target \`${primary.targetName}\`)`
      : "";
    return `Main source file: ${primary.path}${target}`;
  }
  return `Main source file: ${primary.path}`;
}

export function importProjectFromFiles(
  files: Record<string, string>,
  options: ImportProjectOptions = {},
): ImportedProjectResult {
  const statusMessages: UploadStatusMessage[] = [];
  try {
    const normalizedFiles = Object.fromEntries(
      Object.entries(files).map(([pathName, content]) => [
        normalizePath(pathName),
        normalizeText(content),
      ]),
    );

    const fileCount = Object.keys(normalizedFiles).length;
    statusMessages.push({
      type: "success",
      message: `Found ${fileCount} file${fileCount === 1 ? "" : "s"}.`,
    });
    appendCountsStatus(statusMessages, normalizedFiles);

    // One survey of the upload decides everything downstream: which file is
    // the root, what format it is, and which other roots are on offer. Hosts
    // call the same function to build their pickers, so what the user sees and
    // what the import does cannot drift apart.
    const analysis = analyzeImportSources(normalizedFiles, {
      sourceFormat: options.sourceFormat,
      mainFile: options.mainFile ? normalizePath(options.mainFile) : undefined,
    });
    const primary = analysis.primary;
    if (!primary) {
      throw new Error("No files were found in the uploaded source.");
    }

    const sourcePath = primary.path;
    const sourceType = uploadSourceTypeFor(primary.format);
    let sourceText = normalizedFiles[sourcePath] ?? "";
    // Paths folded into the imported document: they must not also be copied
    // through verbatim when an existing project is preserved.
    const consumedPaths = new Set<string>([sourcePath]);

    if (analysis.manifest) {
      const targetCount = analysis.manifest.targets.length;
      statusMessages.push({
        type: "success",
        message: `Found ${analysis.manifest.manifestPath} with ${targetCount} target${
          targetCount === 1 ? "" : "s"
        }: ${analysis.manifest.targets.map((t) => t.name).join(", ")}.`,
      });
    }

    const attachments = resolveAttachments(options.attachRoots, analysis);
    let attachedRoots: AttachedRootRecord[] = [];
    const attachWarnings = [];
    const pretextIncludeWarnings: CleaningWarning[] = [];

    if (primary.format === "latex") {
      const texFiles = Object.fromEntries(
        Object.entries(normalizedFiles).filter(
          ([pathName]) => extension(pathName) === "tex",
        ),
      );

      const expanded = expandTexInputs(sourceText, sourcePath, texFiles);
      sourceText = normalizeText(expanded.expandedText);
      expanded.consumedPaths.forEach((path) => consumedPaths.add(path));

      if (expanded.expandedCount > 0) {
        statusMessages.push({
          type: "success",
          message: `Expanded ${expanded.expandedCount} input/include reference${
            expanded.expandedCount === 1 ? "" : "s"
          }.`,
        });
      }
      if (expanded.missingInputs.length > 0) {
        statusMessages.push({
          type: "error",
          message: `Missing input/include files: ${expanded.missingInputs.join(", ")}.`,
        });
      }

      if (attachments.length > 0) {
        // Each attached root gets its own \input expansion first, so a
        // multi-file chapter attaches whole.
        const attachSources: Record<string, string> = {};
        for (const attachment of attachments) {
          const contents = normalizedFiles[attachment.path];
          if (contents === undefined) {
            continue;
          }
          const attachExpansion = expandTexInputs(
            contents,
            attachment.path,
            texFiles,
          );
          attachSources[attachment.path] = attachExpansion.expandedText;
          attachExpansion.consumedPaths.forEach((path) =>
            consumedPaths.add(path),
          );
          consumedPaths.add(attachment.path);
        }

        const result = attachLatexRoots(sourceText, attachments, attachSources);
        sourceText = normalizeText(result.source);
        attachedRoots = result.attached;
        attachWarnings.push(...result.warnings);
      }
    } else if (primary.format === "markdown") {
      if (attachments.length > 0) {
        const result = attachMarkdownRoots(
          sourceText,
          attachments,
          normalizedFiles,
        );
        sourceText = normalizeText(result.source);
        attachedRoots = result.attached;
        attachWarnings.push(...result.warnings);
        attachedRoots.forEach((root) => consumedPaths.add(root.path));
      }
    } else {
      const ptxFiles = Object.fromEntries(
        Object.entries(normalizedFiles).filter(([pathName]) => {
          const ext = extension(pathName);
          return ext === "ptx" || ext === "xml";
        }),
      );
      const expansion = expandPretextIncludes(sourceText, sourcePath, ptxFiles);
      sourceText = expansion.expandedText;
      expansion.consumedPaths.forEach((path) => consumedPaths.add(path));

      if (expansion.expandedCount > 0) {
        statusMessages.push({
          type: "success",
          message: `Expanded ${expansion.expandedCount} xi:include reference${
            expansion.expandedCount === 1 ? "" : "s"
          }.`,
        });
      }
      if (expansion.missingIncludes.length > 0) {
        statusMessages.push({
          type: "error",
          message: `Missing xi:include targets: ${expansion.missingIncludes.join(", ")}.`,
        });
        pretextIncludeWarnings.push({
          action: "anomaly",
          severity: "error",
          kind: "structure",
          category: "missing_include",
          macro: "xi:include",
          occurrences: expansion.missingIncludes.length,
          examples: expansion.missingIncludes,
          message: `Missing xi:include targets: ${expansion.missingIncludes.join(", ")}. This content is missing from the import.`,
        });
      }
    }

    statusMessages.push({ type: "success", message: describePrimary(primary) });
    for (const root of attachedRoots) {
      statusMessages.push({
        type: "success",
        message: `Attached ${root.path} as a ${root.level}: ${root.title}`,
      });
    }

    const result = convertSourceToPretext(sourceText, primary.format);
    if ("pretextError" in result) {
      return {
        pretextError: result.pretextError,
        statusMessages,
        warnings: [
          ...result.warnings,
          ...attachWarnings,
          ...pretextIncludeWarnings,
        ],
      };
    }

    const {
      buildLayout = true,
      assets: rawAssets = {},
      ...layoutOptions
    } = options;

    // An upload with a project.ptx keeps its own layout: the target's source
    // path, its publication file, and every asset at the path the document
    // already references.
    const manifest = analysis.manifest;
    const manifestTarget =
      manifest && primary.reason === "manifest-target"
        ? targetForPath(
            manifest,
            primary.path.slice(
              manifest.projectRoot ? manifest.projectRoot.length + 1 : 0,
            ),
          )
        : undefined;
    const preserveProject =
      buildLayout &&
      manifest !== null &&
      manifestTarget !== undefined &&
      (options.preserveProjectLayout ?? true);

    const projectLayout: ProjectLayout = {
      mainSourcePath:
        layoutOptions.mainSourcePath ??
        (preserveProject && manifestTarget
          ? manifestTarget.source
          : "source/main.ptx"),
      publicationPath:
        layoutOptions.publicationPath ??
        (preserveProject && manifestTarget?.publication
          ? manifestTarget.publication
          : "publication/publication.ptx"),
      projectFilePath: layoutOptions.projectFilePath ?? "project.ptx",
      preserved: preserveProject,
    };

    const outputAssets: Record<string, Uint8Array> = {};
    const importableAssets: Record<string, Uint8Array> = {};
    const outputFiles: Record<string, string> = {};

    if (preserveProject && manifest && manifestTarget) {
      const carried = carryOverProjectFiles({
        manifest,
        target: manifestTarget,
        files: normalizedFiles,
        assets: rawAssets,
        consumedPaths,
      });
      Object.assign(outputFiles, carried.files);
      Object.assign(outputAssets, carried.assets);
      for (const [originalPath, bytes] of Object.entries(rawAssets)) {
        importableAssets[originalPath] = bytes;
      }
      statusMessages.push({
        type: "success",
        message: `Carried over ${Object.keys(carried.files).length} project file${
          Object.keys(carried.files).length === 1 ? "" : "s"
        } and ${Object.keys(carried.assets).length} asset${
          Object.keys(carried.assets).length === 1 ? "" : "s"
        } unchanged.`,
      });
      if (carried.skipped.length > 0) {
        statusMessages.push({
          type: "success",
          message: `Skipped build output: ${carried.skipped.length} file${
            carried.skipped.length === 1 ? "" : "s"
          }.`,
        });
      }
    } else {
      // Route binary assets to source/assets/<filename>; the same set feeds
      // the division pool's ref-keyed asset list.
      for (const [originalPath, bytes] of Object.entries(rawAssets)) {
        const routed = routeAssetPath(originalPath);
        if (routed) {
          outputAssets[routed] = bytes;
          importableAssets[originalPath] = bytes;
        }
      }
    }

    // Build the intermediate model (division pool, SPEC §4.1); outputFiles
    // is derived from it via the file-tree serializer so both hosts consume
    // projections of the same pool.
    // How deep to split. When the caller expressed no preference, the depth is
    // derived from the document's own size and shape rather than fixed at
    // "chapters for a book, nothing for an article" — which used to leave a
    // thirty-section article in one enormous file (SPEC §8.7).
    // Detected here rather than left to `buildDivisionPool`: the split depth
    // depends on whether this is a book or an article, so the kind has to be
    // settled before the depth can be.
    const resolvedKind =
      layoutOptions.documentKind ?? detectDocumentKind(result.pretextSource);
    const splitLevel = buildLayout
      ? resolveImportSplitLevel(layoutOptions, {
          format: result.sourceFormat,
          latexSource: result.cleanedNativeSource,
          documentKind: resolvedKind,
        })
      : 0;

    const pool = buildDivisionPool(result.pretextSource, {
      documentKind: resolvedKind,
      splitLevel,
      assets: importableAssets,
    });

    if (buildLayout) {
      Object.assign(
        outputFiles,
        serializeProjectToFiles(pool.project, {
          mainSourcePath: projectLayout.mainSourcePath,
          publicationPath: projectLayout.publicationPath,
          projectFilePath: projectLayout.projectFilePath,
          // A preserved project brings its own publication file; only the
          // manifest is regenerated, from the original targets.
          includeScaffold: !preserveProject,
        }).files,
      );
      if (preserveProject && manifest && manifestTarget) {
        outputFiles[projectLayout.projectFilePath] =
          renderProjectPtxFromManifest(manifest, manifestTarget, {
            mainSource: projectLayout.mainSourcePath,
            publication: projectLayout.publicationPath,
          });
        if (!(projectLayout.publicationPath in outputFiles)) {
          outputFiles[projectLayout.publicationPath] = renderPublicationPtx();
        }
      }
    } else {
      outputFiles["source/main.ptx"] = result.pretextSource;
    }

    // Route text auxiliaries (e.g., .bib) into output as well.
    for (const [originalPath, content] of Object.entries(normalizedFiles)) {
      const routed = routeTextAuxiliaryPath(originalPath);
      if (routed && !(routed in outputFiles)) {
        outputFiles[routed] = content;
      }
    }

    const documentKind = pool.project.documentKind;
    const combinedWarnings = [
      ...result.warnings,
      ...attachWarnings,
      ...pretextIncludeWarnings,
      ...pool.warnings,
    ];

    let nativeOutputFiles: Record<string, string> | undefined;
    let nativeProject: ImportedProject | undefined;
    if (
      result.cleanedNativeSource !== undefined &&
      result.cleanedNativeSource.length > 0 &&
      (result.sourceFormat === "latex" || result.sourceFormat === "markdown")
    ) {
      // VS Code native mode still writes a single collapsed source file; the
      // native division pool below is for the pretext-plus host (SPEC §4.3),
      // where native divisions joined by `\plus{…}` / `::…` are first-class.
      nativeOutputFiles = {
        [result.sourceFormat === "latex"
          ? "source/main.tex"
          : "source/main.md"]: result.cleanedNativeSource,
      };
      // Reuse the PreTeXt pool's title/docinfo/kind: those are project-level in
      // the plus model and format-independent, so only the body needs splitting.
      nativeProject = buildNativeDivisionPool(
        result.cleanedNativeSource,
        result.sourceFormat,
        {
          documentKind,
          splitLevel,
          title: pool.project.title,
          docinfo: pool.project.docinfo,
          assets: importableAssets,
        },
      ).project;
    }

    if (Object.keys(rawAssets).length > 0) {
      statusMessages.push({
        type: "success",
        message: `Routed ${Object.keys(outputAssets).length} binary asset${
          Object.keys(outputAssets).length === 1 ? "" : "s"
        }.`,
      });
    }

    return {
      ...result,
      warnings: combinedWarnings,
      sourcePath,
      sourceName: basename(sourcePath),
      sourceType,
      analysis,
      attachedRoots,
      projectLayout,
      project: pool.project,
      nativeProject,
      files: normalizedFiles,
      assets: rawAssets,
      outputFiles,
      outputAssets,
      nativeOutputFiles,
      documentKind,
      cleanChunks: result.cleanChunks ?? [],
      splitLevel,
      statusMessages,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusMessages.push({ type: "error", message });
    return {
      pretextError: message,
      statusMessages,
      warnings: [],
    };
  }
}

export async function handleImportUploadFile(
  file: File,
  options: ImportProjectOptions = {},
): Promise<ImportedProjectResult> {
  const statusMessages: UploadStatusMessage[] = [];
  const sourceName = normalizePath(file.name);
  if (!SUPPORTED_UPLOAD_PATTERN.test(sourceName.toLowerCase())) {
    return {
      pretextError:
        "File format not supported: please upload .tex, .md, .ptx, .xml, .zip, or .tar.gz.",
      statusMessages: [
        {
          type: "error",
          message:
            "File format not supported: please upload .tex, .md, .ptx, .xml, .zip, or .tar.gz.",
        },
      ],
      warnings: [],
    };
  }

  statusMessages.push({
    type: "loading",
    message: `Processing ${sourceName}...`,
  });

  try {
    const { files, assets } = await extractUpload(file);
    const imported = importProjectFromFiles(files, { ...options, assets });
    return {
      ...imported,
      statusMessages: [...statusMessages, ...imported.statusMessages],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      pretextError: message,
      statusMessages: [...statusMessages, { type: "error", message }],
      warnings: [],
    };
  }
}

/**
 * Decide the split depth for an import.
 *
 * An explicit `splitLevel` wins; the legacy `splitChapters`/`splitSections`
 * booleans are honoured next (they predate the depth number and still appear in
 * host options); otherwise the depth is suggested from the source's size and
 * structure.
 */
export interface SplitLevelContext {
  format: SourceFormat;
  /** Cleaned LaTeX source, when there is one. */
  latexSource?: string;
  documentKind?: DocumentKind;
}

export function resolveImportSplitLevel(
  options: ImportProjectOptions,
  context: SplitLevelContext,
): number {
  if (options.splitLevel !== undefined) {
    return Math.max(0, options.splitLevel);
  }
  if (options.splitChapters === false) {
    return 0;
  }
  if (options.splitSections) {
    return context.documentKind === "book" ? 2 : 1;
  }
  if (options.splitChapters) {
    return 1;
  }

  // The size heuristic reads LaTeX sectioning commands, so it only speaks for a
  // LaTeX import. Markdown and PreTeXt keep the historical default — a book
  // splits its chapters, an article stays whole — until they grow an equivalent
  // of their own.
  if (context.format === "latex" && context.latexSource) {
    return suggestSplitLevel(
      context.latexSource,
      context.documentKind ??
        (context.latexSource.includes("\\chapter") ? "book" : "article"),
    );
  }
  return context.documentKind === "book" ? 1 : 0;
}

/**
 * Re-derive an import's file layout at a different split depth.
 *
 * Everything expensive — extraction, include expansion, cleaning, and the
 * unified-latex conversion — already happened and is carried on `result`. This
 * only rebuilds the division pool and re-serializes it, so a host can offer a
 * live split-depth control without re-importing. Pure: same input, same output,
 * no closures, safe to call across a webview boundary.
 */
export function relayoutImport(
  result: ImportedProjectSuccess,
  splitLevel: number,
): ImportedProjectSuccess {
  const depth = Math.max(0, splitLevel);
  if (depth === result.splitLevel) {
    return result;
  }

  const pool = buildDivisionPool(result.pretextSource, {
    documentKind: result.documentKind,
    splitLevel: depth,
    assets: result.assets,
  });

  const outputFiles: Record<string, string> = {};
  // Non-source files (publication, manifest, .bib, and anything an existing
  // project carried over) are independent of split depth, so they are kept as
  // they were rather than regenerated.
  for (const [path, content] of Object.entries<string>(result.outputFiles)) {
    if (!isSplitDerivedPath(path, result.projectLayout.mainSourcePath)) {
      outputFiles[path] = content;
    }
  }
  Object.assign(
    outputFiles,
    serializeProjectToFiles(pool.project, {
      mainSourcePath: result.projectLayout.mainSourcePath,
      publicationPath: result.projectLayout.publicationPath,
      projectFilePath: result.projectLayout.projectFilePath,
      includeScaffold: !result.projectLayout.preserved,
    }).files,
  );

  let nativeProject = result.nativeProject;
  if (
    result.cleanedNativeSource &&
    (result.sourceFormat === "latex" || result.sourceFormat === "markdown")
  ) {
    nativeProject = buildNativeDivisionPool(
      result.cleanedNativeSource,
      result.sourceFormat,
      {
        documentKind: result.documentKind,
        splitLevel: depth,
        title: pool.project.title,
        docinfo: pool.project.docinfo,
        assets: result.assets,
      },
    ).project;
  }

  return {
    ...result,
    splitLevel: depth,
    project: pool.project,
    nativeProject,
    outputFiles,
  };
}

/** True for a file the division serializer owns and will regenerate. */
function isSplitDerivedPath(path: string, mainSourcePath: string): boolean {
  if (path === mainSourcePath) return true;
  const sourceDir = mainSourcePath.includes("/")
    ? mainSourcePath.slice(0, mainSourcePath.lastIndexOf("/") + 1)
    : "";
  return path.startsWith(sourceDir) && path.endsWith(".ptx");
}
