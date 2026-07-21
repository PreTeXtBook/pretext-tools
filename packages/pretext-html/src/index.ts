export {
  renderHtml,
  defaultXslDir,
  isJspiAvailable,
  xpathStringLiteral,
} from "./renderer.js";
export type { RenderOptions, RenderResult } from "./renderer.js";
// Source-map helpers for editor/preview sync (see sourcemap.ts). The map
// itself comes back from renderHtml({ sourceMap: true }).
export { findSourceMapEntry } from "./sourcemap.js";
export type { PtxSourceMap, SourceMapEntry } from "./sourcemap.js";
export { forcePortablePublication } from "./publication.js";
// Retargeting the `external/` and `generated/` asset URLs a portable build
// emits onto something the host can serve (see assets.ts). Pair with
// RenderResult.assetDirs.
export { rewriteAssetUrls } from "./assets.js";
export type { AssetKind, AssetUrlResolver } from "./assets.js";
// Stand-ins for assets that have not been generated (or cannot be found).
export {
  describeAsset,
  missingAssetPlaceholder,
  missingAssetSvg,
} from "./missing-asset.js";
export type { MissingAsset } from "./missing-asset.js";
export type { AssetDirectories } from "./publication.js";
// Runtime light/dark theme control (see theme.ts). The renderer injects the
// bridge when RenderOptions.theme is set; embedders post previewThemeMessage()
// to update it live. Also published as the dependency-free
// "@pretextbook/pretext-html/theme" subpath for embedders that only need the
// message protocol and not the WASM renderer.
export {
  PREVIEW_THEME_MESSAGE,
  isPreviewTheme,
  previewThemeMessage,
  themeBridgeScript,
  injectThemeBridge,
} from "./theme.js";
export type { PreviewTheme, PreviewThemeMessage } from "./theme.js";
// The CLI driver, re-exported so embedders that fork a bundled worker (the
// VS Code extension) can reuse the argument parsing and stdout protocol.
export { main as runCli } from "./cli.js";
// Where this package's assets/ directory is read from; the programmatic
// equivalent of the PRETEXT_HTML_ASSETS environment variable.
export { setAssetsBase } from "./host.js";
// Advanced: override how mounted stylesheet files are read (see mounts.ts).
// Lets an embedder serve the stylesheets from an in-memory map, a zip, or a
// webview resource URI, and is how the XSL bundle is recorded at build time.
export { setMountReader } from "./mounts.js";
export type { MountReader } from "./mounts.js";
