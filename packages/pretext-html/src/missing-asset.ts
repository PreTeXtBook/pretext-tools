/**
 * Placeholder images for assets a preview cannot find.
 *
 * A preview routinely runs against a project whose images have never been
 * built — `pretext generate` is a separate, slow, Python-side step, and the
 * whole point of this renderer is not to need it. Left alone, those images
 * render as the browser's broken-image glyph, which reads as "the preview is
 * broken" rather than "this figure has not been generated yet".
 *
 * So instead of declining to rewrite a missing asset, a host can swap in a
 * data-URI SVG that says what is missing and what to do about it. The two
 * cases want different words: a missing *generated* file is a build step the
 * author has not run yet (actionable, and the asset's own subdirectory names
 * the `pretext generate` target), while a missing *external* file is almost
 * always a wrong `@source` (a typo to fix).
 *
 * The SVG carries a `data-ptx-missing="<kind>:<type>"` attribute, and the
 * encoding below deliberately leaves it legible inside the data URI. That is
 * the hook for turning these into buttons later: a webview script can find
 * them with `img[src*="data-ptx-missing"]`, read the kind and type back out,
 * and replace them with something clickable that triggers a real generate run.
 */

import type { AssetKind } from "./assets.js";

/** What a missing asset is, in the terms an author would recognise. */
export interface MissingAsset {
  kind: AssetKind;
  /**
   * For generated assets, the producing tool — `latex-image`, `sageplot`,
   * `asymptote`, `prefigure` — which under managed directories is literally
   * the first path segment, and is also the `pretext generate` target. For
   * external assets, a coarse media word derived from the extension.
   */
  assetType: string;
  /** Basename, for display. */
  fileName: string;
}

const MEDIA_TYPES: Record<string, string> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  svg: "image",
  webp: "image",
  avif: "image",
  mp4: "video",
  webm: "video",
  ogv: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  pdf: "PDF",
};

/**
 * Classify an asset path. Generated paths are `<tool>/<name>` under managed
 * directories; a path with no directory segment predates that scheme, so there
 * is no tool name to report.
 */
export function describeAsset(kind: AssetKind, relPath: string): MissingAsset {
  const segments = relPath.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] ?? relPath;
  if (kind === "generated") {
    return {
      kind,
      assetType: segments.length > 1 ? segments[0]! : "generated",
      fileName,
    };
  }
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return { kind, assetType: MEDIA_TYPES[extension] ?? "file", fileName };
}

/** Escape text for an XML text node / attribute value. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Keep long filenames from overflowing the placeholder's width. */
function truncate(value: string, max = 38): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * The three lines of the placeholder: what is missing, which file, and what to
 * do about it.
 */
function describeLines(asset: MissingAsset): [string, string, string] {
  if (asset.kind === "generated") {
    return [
      "Asset not generated yet",
      `${asset.assetType} · ${truncate(asset.fileName)}`,
      `Run: pretext generate ${asset.assetType}`,
    ];
  }
  return [
    "External asset not found",
    `${asset.assetType} · ${truncate(asset.fileName)}`,
    "Check @source and the external directory",
  ];
}

// Warm amber, legible on both light and dark page backgrounds because the
// placeholder paints its own panel rather than inheriting one. An <img> is an
// isolated document, so `currentColor` and the page's theme variables are not
// available here.
const PANEL = "#fffbeb";
const BORDER = "#f59e0b";
const INK = "#92400e";
const INK_SOFT = "#b45309";

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/** Render the placeholder as standalone SVG markup. */
export function missingAssetSvg(asset: MissingAsset): string {
  const [heading, detail, hint] = describeLines(asset);
  const label = `${heading}: ${asset.fileName}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 130"` +
    ` role="img" aria-label="${escapeXml(label)}"` +
    ` data-ptx-missing="${escapeXml(`${asset.kind}:${asset.assetType}`)}">` +
    `<rect x="1" y="1" width="418" height="128" rx="8" fill="${PANEL}"` +
    ` stroke="${BORDER}" stroke-width="2" stroke-dasharray="6 4"/>` +
    // Warning triangle, with its bar and dot.
    `<path d="M40 44 L60 80 L20 80 Z" fill="none" stroke="${INK_SOFT}"` +
    ` stroke-width="3" stroke-linejoin="round"/>` +
    `<rect x="38.5" y="56" width="3" height="12" fill="${INK_SOFT}"/>` +
    `<rect x="38.5" y="71" width="3" height="3" fill="${INK_SOFT}"/>` +
    `<text x="78" y="54" font-family="${FONT}" font-size="15"` +
    ` font-weight="600" fill="${INK}">${escapeXml(heading)}</text>` +
    `<text x="78" y="77" font-family="${FONT}" font-size="13"` +
    ` fill="${INK_SOFT}">${escapeXml(detail)}</text>` +
    `<text x="78" y="99" font-family="${FONT}" font-size="12"` +
    ` fill="${INK_SOFT}" opacity="0.85">${escapeXml(hint)}</text>` +
    `</svg>`
  );
}

/**
 * The placeholder as a `data:` URI, ready to drop into an `img` `src`.
 *
 * Percent-encoded rather than base64 so the `data-ptx-missing` marker stays
 * greppable in the emitted page (see the module comment), and so the payload
 * stays readable when someone views source. Only the characters that would
 * break a URI or an HTML attribute are escaped.
 */
export function missingAssetPlaceholder(
  kind: AssetKind,
  relPath: string,
): string {
  const svg = missingAssetSvg(describeAsset(kind, relPath));
  const encoded = svg
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/&/g, "%26")
    .replace(/"/g, "%22")
    .replace(/'/g, "%27")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/\s+/g, " ");
  return `data:image/svg+xml,${encoded}`;
}
