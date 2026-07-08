/**
 * Entry point for the instant-preview worker process.
 *
 * Bundled by esbuild (see build.mjs) into out/instant-preview-worker.mjs and
 * forked from the extension host with `--experimental-wasm-jspi` in execArgv
 * (the XSLT engine needs WebAssembly JSPI). It is simply the
 * @pretextbook/pretext-html CLI: rendered HTML goes to stdout, diagnostics to
 * stderr. The PRETEXT_HTML_ASSETS env var points it at the copied assets
 * (preview-html.xsl + vendored PreTeXt xsl tree).
 */
import { runCli } from "@pretextbook/pretext-html";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    `instant-preview-worker: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
