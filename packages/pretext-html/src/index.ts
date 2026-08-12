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
export type { PublicationOverrides } from "./publication.js";
// Which conversion a render runs (ordinary HTML vs a reveal.js slideshow).
export { detectRenderTarget } from "./target.js";
export type { RenderTarget } from "./target.js";
// Slideshow view control (see reveal.ts). The renderer injects the bridge for
// slideshow renders; embedders re-inject over the returned HTML to switch
// views without re-rendering.
export {
  injectRevealBridge,
  isRevealView,
  revealBridgeScript,
} from "./reveal.js";
export type { RevealView, RevealViewOptions } from "./reveal.js";
// Expanding born-hidden knowls (see knowls.ts). The renderer applies this
// unless RenderOptions.openKnowls is false; exported so an embedder can apply
// it to HTML it already has, without re-rendering.
export { openBornHiddenKnowls } from "./knowls.js";
// Placing a fragment in its document, so it is numbered and cross-referenced
// as the built book will be (see skeleton.ts). The renderer does this itself
// when RenderOptions.contextSourcePath is set; exported for embedders that
// prepare source themselves.
export { buildSkeleton, divisionLevel, replaceDivision } from "./skeleton.js";
export type { Skeleton } from "./skeleton.js";
// Making a subtree render's links honest about the one page it produced (see
// xrefs.ts). Applied by the renderer; exported so an embedder can apply it to
// HTML it already has, or reword the tooltip.
export { OFF_PAGE_MESSAGE, rewriteXrefLinks } from "./xrefs.js";
export type { RewriteXrefLinkOptions } from "./xrefs.js";
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
// The dismissible "this is a live preview" banner (see banner.ts). The
// renderer injects it when RenderOptions.previewBanner is set; exported so an
// embedder can apply it to HTML it already has, without re-rendering.
export {
  PREVIEW_BANNER_STORAGE_KEY,
  injectPreviewBanner,
  previewBannerScript,
} from "./banner.js";
export type { PreviewBannerOptions } from "./banner.js";
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
