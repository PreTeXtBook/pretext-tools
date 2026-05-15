import JSZip from "jszip";
import { convertSourceToPretext } from "./convert";
import { detectSourceFormat } from "./detect-source-format";
import type {
  ImportedProjectResult,
  SourceFormat,
  UploadSourceType,
  UploadStatusMessage,
} from "./types";

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

function parseTar(data: Uint8Array): Record<string, string> {
  const files: Record<string, string> = {};
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
      const content = new TextDecoder().decode(fileData);
      files[normalizePath(header.name)] = normalizeText(content);
    }

    offset += paddedSize;
  }

  return files;
}

async function extractFilesFromUpload(
  file: File,
): Promise<Record<string, string>> {
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
    return { [normalizePath(file.name)]: normalizeText(content) };
  }

  if (sourceType === "zip") {
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);
    const files: Record<string, string> = {};

    for (const [entryPath, zipEntry] of Object.entries(contents.files)) {
      if (zipEntry.dir) {
        continue;
      }
      const content = await zipEntry.async("string");
      files[normalizePath(entryPath)] = normalizeText(content);
    }

    return files;
  }

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

  const pretextPath = sortedPaths.find((pathName) => {
    const ext = extension(pathName);
    return ext === "ptx" || ext === "xml";
  });
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
    }

    statusMessages.push({
      type: "success",
      message: `Main source file: ${sourcePath}`,
    });

    const conversionFormat = toConversionSourceFormat(sourceType);
    const result = convertSourceToPretext(sourceText, conversionFormat);
    if ("pretextError" in result) {
      return {
        pretextError: result.pretextError,
        statusMessages,
      };
    }

    return {
      ...result,
      sourcePath,
      sourceName: sourcePath.split("/").pop() ?? sourcePath,
      sourceType,
      files: normalizedFiles,
      statusMessages,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusMessages.push({ type: "error", message });
    return {
      pretextError: message,
      statusMessages,
    };
  }
}

export async function handleImportUploadFile(
  file: File,
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
    };
  }

  statusMessages.push({
    type: "loading",
    message: `Processing ${sourceName}...`,
  });

  try {
    const files = await extractFilesFromUpload(file);
    const imported = importProjectFromFiles(files);
    return {
      ...imported,
      statusMessages: [...statusMessages, ...imported.statusMessages],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      pretextError: message,
      statusMessages: [...statusMessages, { type: "error", message }],
    };
  }
}
