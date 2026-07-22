// Projects the division pool (SPEC §4.1) onto the wire shape pretext-plus's
// `POST /projects/import` expects (SPEC §4.3): a snake_case mirror of
// `ProjectsController#import_params`, with asset bytes base64-encoded into a
// nested `file` object — the whole import travels as one JSON body, no
// multipart round-trip.

import type {
  ImportedProject,
  PlusAssetAttributes,
  PlusProjectPayload,
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

function guessContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ASSET_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64-encode bytes without `btoa`/`Buffer`, so it runs identically in the
 * browser (pretext-plus) and the VS Code extension host.
 */
function bytesToBase64(bytes: Uint8Array): string {
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

function serializeAsset(
  asset: ImportedProject["assets"][number],
): PlusAssetAttributes {
  return {
    ref: asset.ref,
    kind: "file",
    title: asset.fileName,
    short_description: asset.fileName,
    file: {
      filename: asset.fileName,
      content_type: guessContentType(asset.fileName),
      data: bytesToBase64(asset.data),
    },
  };
}

/**
 * Serialize the division pool to a pretext-plus import payload.
 */
export function serializeProjectToPlusPayload(
  project: ImportedProject,
): PlusProjectPayload {
  return {
    title: project.title,
    docinfo: project.docinfo,
    document_type: project.documentKind,
    divisions_attributes: project.divisions.map((division) => ({
      ref: division.xmlId,
      source: division.content,
      source_format: division.sourceFormat,
      is_root: division.isRoot,
    })),
    assets_attributes: project.assets.map(serializeAsset),
  };
}
