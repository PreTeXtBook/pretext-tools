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
// The CLI driver, re-exported so embedders that fork a bundled worker (the
// VS Code extension) can reuse the argument parsing and stdout protocol.
export { main as runCli } from "./cli.js";
