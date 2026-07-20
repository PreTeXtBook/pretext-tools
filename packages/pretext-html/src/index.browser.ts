/**
 * Browser entry point (the "browser" export condition; see package.json).
 *
 * Identical to index.ts except that it drops `runCli` — the CLI reads argv and
 * writes files, and importing it would drag `node:process` into a browser
 * bundle — and adds `setAssetsBase`, which only the browser build needs.
 *
 * Requirements and caveats specific to this build:
 *
 *  - **WebAssembly JSPI** must be available. Check `isJspiAvailable()` before
 *    calling `renderHtml` and fall back to a server-side build when it is
 *    false; several engines still do not ship it.
 *  - **Pass `sourceContent`.** There is no filesystem, so `sourcePath` serves
 *    only as a virtual base for URL and xi:include resolution.
 *  - **`xi:include`s are not resolved from disk.** Pre-merge them, or pass the
 *    already-merged document as `sourceContent`.
 *  - **Assets come from jsDelivr by default**, version-pinned to this package.
 *    Call `setAssetsBase()` before the first render to self-host.
 */

export {
  renderHtml,
  defaultXslDir,
  isJspiAvailable,
  xpathStringLiteral,
} from "./renderer.js";
export type { RenderOptions, RenderResult } from "./renderer.js";
export { findSourceMapEntry } from "./sourcemap.js";
export type { PtxSourceMap, SourceMapEntry } from "./sourcemap.js";
export { forcePortablePublication } from "./publication.js";
export {
  PREVIEW_THEME_MESSAGE,
  isPreviewTheme,
  previewThemeMessage,
  themeBridgeScript,
  injectThemeBridge,
} from "./theme.js";
export type { PreviewTheme, PreviewThemeMessage } from "./theme.js";
// Where this package's assets/ directory is served from. Browser-only: under
// Node the equivalent is the PRETEXT_HTML_ASSETS environment variable.
export { setAssetsBase } from "./host.js";
// Advanced: override how mounted stylesheet files are read.
export { setMountReader } from "./mounts.js";
export type { MountReader } from "./mounts.js";
