#!/usr/bin/env node
// Entry point for the pretext-html CLI. The XSLT engine (libxslt-wasm) needs
// WebAssembly JSPI, which Node only enables behind --experimental-wasm-jspi,
// and that flag is not allowed in NODE_OPTIONS. So: if JSPI is off, re-launch
// this same script with the flag; otherwise run the real CLI.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if ("Suspending" in WebAssembly) {
  const { main } = await import("./dist/cli.js");
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`pretext-html: ${error?.message ?? error}`);
    process.exit(1);
  }
} else {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-wasm-jspi",
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
