export {
  renderHtml,
  defaultXslDir,
  isJspiAvailable,
  xpathStringLiteral,
} from "./renderer.js";
export type { RenderOptions, RenderResult } from "./renderer.js";
export { forcePortablePublication } from "./publication.js";
// The CLI driver, re-exported so embedders that fork a bundled worker (the
// VS Code extension) can reuse the argument parsing and stdout protocol.
export { main as runCli } from "./cli.js";
