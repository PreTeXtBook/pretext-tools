// Projects the division pool (SPEC §4.1) onto a flat, ref-addressed set of
// records (SPEC §4.3): the shape a host that stores divisions in a database
// wants, rather than the file tree `serialize-files.ts` produces.
//
// Named for what it is rather than who consumes it. pretext-plus is the host
// this was written for, and `serialize-plus.ts` adapts these records to its
// endpoint's own field names — but nothing here is specific to it, and a second
// hosted consumer should not have to import something called "plus".

import type {
  AssetRecord,
  DivisionRecord,
  ImportedAsset,
  ImportedProject,
  ProjectRecords,
} from "../types";

// Content types for the binary extensions `upload.ts` routes as assets
// (BINARY_EXTENSIONS); anything else falls back to a generic octet stream.
const ASSET_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  pdf: "application/pdf",
  eps: "application/postscript",
  ps: "application/postscript",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  webp: "image/webp",
  ico: "image/vnd.microsoft.icon",
};

export function guessContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ASSET_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64-encode bytes without `btoa`/`Buffer`, so it runs identically in the
 * browser and the VS Code extension host.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const chars: string[] = [];
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < len;
    const hasB2 = i + 2 < len;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;

    chars.push(BASE64_CHARS[b0 >> 2]);
    chars.push(BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)]);
    chars.push(hasB1 ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=");
    chars.push(hasB2 ? BASE64_CHARS[b2 & 0x3f] : "=");
  }
  return chars.join("");
}

export function assetToRecord(asset: ImportedAsset): AssetRecord {
  return {
    ref: asset.ref,
    fileName: asset.fileName,
    contentType: guessContentType(asset.fileName),
    data: bytesToBase64(asset.data),
  };
}

export function divisionToRecord(
  division: ImportedProject["divisions"][number],
): DivisionRecord {
  return {
    ref: division.xmlId,
    source: division.content,
    sourceFormat: division.sourceFormat,
    isRoot: division.isRoot,
  };
}

/** Serialize the whole division pool as records. */
export function serializeProjectToRecords(
  project: ImportedProject,
): ProjectRecords {
  return {
    title: project.title,
    docinfo: project.docinfo,
    documentKind: project.documentKind,
    divisions: project.divisions.map(divisionToRecord),
    assets: project.assets.map(assetToRecord),
  };
}
