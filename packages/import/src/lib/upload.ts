import JSZip from "jszip";
import { convertSourceToPretext } from "./convert";
import { detectSourceFormat } from "./detect-source-format";
import {
  expandPretextIncludes,
  findLikelyMainPretextPath,
} from "./clean/pretext-includes";
import { type BuildProjectFilesOptions } from "./layout";
import {
  buildDivisionPool,
  buildNativeDivisionPool,
  serializeProjectToFiles,
} from "./pool";
import type {
  ImportedProject,
  ImportedProjectResult,
  SourceFormat,
  UploadSourceType,
  UploadStatusMessage,
} from "./types";

export interface ImportProjectOptions extends BuildProjectFilesOptions {
  /** When true (default), the layout splitter runs and outputFiles is populated. */
  buildLayout?: boolean;
  /** Raw binary assets keyed by their source path (e.g. images, PDFs). */
  assets?: Record<string, Uint8Array>;
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

function basenameOf(pathName: string): string {
  return pathName.split("/").pop() ?? pathName;
}

function routeAssetPath(originalPath: string): string | null {
  const base = basenameOf(originalPath);
  const ext = extension(base);
  if (IMAGE_EXTENSIONS.has(ext)) {
    return `source/assets/${base}`;
  }
  return null;
}

function routeTextAuxiliaryPath(originalPath: string): string | null {
  const base = basenameOf(originalPath);
  const ext = extension(base);
  if (ext === "bib") {
    return `source/${base}`;
  }
  return null;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/(\n *){3,}/g, "\n\n");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
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

interface ExtractedUpload {
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

async function extractFilesFromUpload(file: File): Promise<ExtractedUpload> {
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

function extension(pathName: string): string {
  const match = pathName.toLowerCase().match(/\.([^.\/]+)$/);
  return match ? match[1] : "";
}

function findLikelyMainTexPath(files: Record<string, string>): string | null {
  const texPaths = Object.keys(files)
    .filter((pathName) => extension(pathName) === "tex")
    .sort();

  if (texPaths.length === 0) {
    return null;
  }

  const withDocument = texPaths.find((pathName) =>
    /\\begin *\{document\}/.test(files[pathName]),
  );

  return withDocument ?? texPaths[0];
}

function findDirectory(pathName: string): string {
  const slashIndex = pathName.lastIndexOf("/");
  return slashIndex >= 0 ? pathName.slice(0, slashIndex) : "";
}

function resolveInputTarget(
  requestedPath: string,
  baseFile: string,
  texFiles: Record<string, string>,
): string | null {
  const baseDirectory = findDirectory(baseFile);
  const candidates = [
    requestedPath,
    `${requestedPath}.tex`,
    baseDirectory ? `${baseDirectory}/${requestedPath}` : requestedPath,
    baseDirectory
      ? `${baseDirectory}/${requestedPath}.tex`
      : `${requestedPath}.tex`,
  ].map(normalizePath);

  return candidates.find((candidate) => candidate in texFiles) ?? null;
}

function expandTexInputs(
  mainTex: string,
  baseFile: string,
  texFiles: Record<string, string>,
): { expandedText: string; expandedCount: number; missingInputs: string[] } {
  let expandedCount = 0;
  const missingInputs: string[] = [];

  const expandOnce = (text: string): { output: string; changed: boolean } => {
    let changed = false;
    const output = text.replace(
      /(\\(input|include) *\{([^{}]+)\})/g,
      (
        _match: string,
        _directive: string,
        _kind: string,
        requested: string,
      ) => {
        const target = resolveInputTarget(requested, baseFile, texFiles);
        if (!target) {
          if (!missingInputs.includes(requested)) {
            missingInputs.push(requested);
          }
          return _match;
        }
        changed = true;
        expandedCount += 1;
        return texFiles[target];
      },
    );

    return { output, changed };
  };

  let current = mainTex;
  for (let pass = 0; pass < 3; pass += 1) {
    const { output, changed } = expandOnce(current);
    current = output;
    if (!changed) {
      break;
    }
  }

  return { expandedText: normalizeText(current), expandedCount, missingInputs };
}

// Shouldn't we already know the source type at this point?
function pickPrimarySourcePath(files: Record<string, string>): {
  sourcePath: string;
  sourceType: UploadSourceType;
} {
  const texPath = findLikelyMainTexPath(files);
  if (texPath) {
    return { sourcePath: texPath, sourceType: "tex" };
  }

  const sortedPaths = Object.keys(files).sort();
  const markdownPath = sortedPaths.find((pathName) => {
    const ext = extension(pathName);
    return ext === "md" || ext === "markdown";
  });
  if (markdownPath) {
    return { sourcePath: markdownPath, sourceType: "markdown" };
  }

  const pretextPath = findLikelyMainPretextPath(files);
  if (pretextPath) {
    return { sourcePath: pretextPath, sourceType: "pretext" };
  }

  if (sortedPaths.length === 0) {
    throw new Error("No files were found in the uploaded source.");
  }

  const fallbackPath = sortedPaths[0];
  const detected = detectSourceFormat(files[fallbackPath]);
  return {
    sourcePath: fallbackPath,
    sourceType: detected === "latex" ? "tex" : detected,
  };
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

function toConversionSourceFormat(sourceType: UploadSourceType): SourceFormat {
  if (sourceType === "tex") {
    return "latex";
  }
  if (sourceType === "markdown") {
    return "markdown";
  }
  return "pretext";
}

export function importProjectFromFiles(
  files: Record<string, string>,
  options: ImportProjectOptions = {},
): ImportedProjectResult {
  const statusMessages: UploadStatusMessage[] = [];
  try {
    // Haven't these been normalized already?
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

    const { sourcePath, sourceType } = pickPrimarySourcePath(normalizedFiles);
    let sourceText = normalizedFiles[sourcePath] ?? "";

    if (sourceType === "tex") {
      const texFiles = Object.fromEntries(
        Object.entries(normalizedFiles).filter(
          ([pathName]) => extension(pathName) === "tex",
        ),
      );

      const { expandedText, expandedCount, missingInputs } = expandTexInputs(
        sourceText,
        sourcePath,
        texFiles,
      );
      sourceText = expandedText;

      if (expandedCount > 0) {
        statusMessages.push({
          type: "success",
          message: `Expanded ${expandedCount} input/include reference${expandedCount === 1 ? "" : "s"}.`,
        });
      }
      if (missingInputs.length > 0) {
        statusMessages.push({
          type: "error",
          message: `Missing input/include files: ${missingInputs.join(", ")}.`,
        });
      }
    } else if (sourceType === "pretext") {
      const ptxFiles = Object.fromEntries(
        Object.entries(normalizedFiles).filter(([pathName]) => {
          const ext = extension(pathName);
          return ext === "ptx" || ext === "xml";
        }),
      );
      const { expandedText, expandedCount, missingIncludes } =
        expandPretextIncludes(sourceText, sourcePath, ptxFiles);
      sourceText = expandedText;

      if (expandedCount > 0) {
        statusMessages.push({
          type: "success",
          message: `Expanded ${expandedCount} xi:include reference${expandedCount === 1 ? "" : "s"}.`,
        });
      }
      if (missingIncludes.length > 0) {
        statusMessages.push({
          type: "error",
          message: `Missing xi:include targets: ${missingIncludes.join(", ")}.`,
        });
      }
    }

    statusMessages.push({
      type: "success",
      message: `Main source file: ${sourcePath}`,
    });

    // Now do the conversion to conversionFormat
    const conversionFormat = toConversionSourceFormat(sourceType);
    const result = convertSourceToPretext(sourceText, conversionFormat);
    if ("pretextError" in result) {
      return {
        pretextError: result.pretextError,
        statusMessages,
        warnings: result.warnings,
      };
    }

    const {
      buildLayout = true,
      assets: rawAssets = {},
      ...layoutOptions
    } = options;

    const outputAssets: Record<string, Uint8Array> = {};
    const importableAssets: Record<string, Uint8Array> = {};

    // Route binary assets to source/assets/<filename>; the same set feeds
    // the division pool's ref-keyed asset list.
    for (const [originalPath, bytes] of Object.entries(rawAssets)) {
      const routed = routeAssetPath(originalPath);
      if (routed) {
        outputAssets[routed] = bytes;
        importableAssets[originalPath] = bytes;
      }
    }

    // Build the intermediate model (division pool, SPEC §4.1); outputFiles
    // is derived from it via the file-tree serializer so both hosts consume
    // projections of the same pool.
    const pool = buildDivisionPool(result.pretextSource, {
      documentKind: layoutOptions.documentKind,
      splitChapters: buildLayout ? layoutOptions.splitChapters : false,
      splitSections: buildLayout ? layoutOptions.splitSections : false,
      assets: importableAssets,
    });

    const outputFiles: Record<string, string> = buildLayout
      ? serializeProjectToFiles(pool.project, {
          mainSourcePath: layoutOptions.mainSourcePath,
          publicationPath: layoutOptions.publicationPath,
          projectFilePath: layoutOptions.projectFilePath,
        }).files
      : { "source/main.ptx": result.pretextSource };

    // Route text auxiliaries (e.g., .bib) into output as well.
    for (const [originalPath, content] of Object.entries(normalizedFiles)) {
      const routed = routeTextAuxiliaryPath(originalPath);
      if (routed && !(routed in outputFiles)) {
        outputFiles[routed] = content;
      }
    }

    const documentKind = pool.project.documentKind;
    const combinedWarnings = [...result.warnings, ...pool.warnings];

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
          splitChapters: buildLayout ? layoutOptions.splitChapters : false,
          splitSections: buildLayout ? layoutOptions.splitSections : false,
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
      sourceName: sourcePath.split("/").pop() ?? sourcePath,
      sourceType,
      project: pool.project,
      nativeProject,
      files: normalizedFiles,
      assets: rawAssets,
      outputFiles,
      outputAssets,
      nativeOutputFiles,
      documentKind,
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
    const { files, assets } = await extractFilesFromUpload(file);
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
