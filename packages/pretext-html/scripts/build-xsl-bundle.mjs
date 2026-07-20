/**
 * Record assets/xsl-bundle.json: every file a real render pulls out of the XSL
 * mount, as one JSON map. The browser build fetches it in a single request
 * instead of ~31 latency-bound round trips (13 stylesheets, localizations.xml,
 * and the 17 locale files pretext-common.xsl eagerly loads).
 *
 * This works by *recording an actual render*, not by walking <xsl:import>
 * statically. Static analysis under-collects badly here: pretext-common.xsl
 * loads localizations via `document($locale-files)` where the argument is a
 * computed node-set, so a static walk finds 13 files and silently misses the
 * 18 that make up more than half the request count.
 *
 * Run after refresh-xsl.mjs, and after `vite build` (it drives the built
 * renderer):
 *
 *   npm run build && npm run build-xsl-bundle
 *
 * The bundle is an optimisation, never a requirement — the browser host falls
 * back to per-file fetches for anything it does not contain, so a stale or
 * missing bundle degrades in speed rather than in correctness.
 */

import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { renderHtml, setMountReader, defaultXslDir } from "../dist/index.js";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const assetsDir = path.join(packageDir, "assets");
const xslDir = path.join(assetsDir, "xsl");
const outputPath = path.join(assetsDir, "xsl-bundle.json");

/**
 * A document that exercises the common path. It does not need to be large —
 * the XSL closure is fixed by <xsl:import>, and the localizations load for any
 * document at all. It only needs to render successfully.
 */
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article xml:id="sample">
    <title>Bundle recording sample</title>
    <section xml:id="sec-sample">
      <title>A section</title>
      <p>Text with <em>emphasis</em>, math <m>x^2</m>, and a list:</p>
      <ul><li><p>An item</p></li></ul>
      <theorem xml:id="thm-sample">
        <statement><p>A statement.</p></statement>
        <proof><p>A proof.</p></proof>
      </theorem>
    </section>
  </article>
</pretext>
`;

async function main() {
  const recorded = new Map();
  const xslRoot = defaultXslDir();

  setMountReader(async (root, relPath) => {
    const base = path.resolve(root);
    const filePath = path.resolve(base, `.${path.posix.normalize(relPath)}`);
    if (filePath !== base && !filePath.startsWith(base + path.sep)) {
      return undefined;
    }
    let data;
    try {
      data = await readFile(filePath);
    } catch {
      return undefined;
    }
    // Record only the XSL mount: project mounts hold the sample's own files,
    // which have no place in a shipped bundle.
    if (base === path.resolve(xslRoot)) {
      recorded.set(relPath.replace(/^\/+/, ""), data.toString("utf8"));
    }
    return new Uint8Array(data);
  });

  await renderHtml({
    sourcePath: path.join(packageDir, "__bundle-sample.ptx"),
    sourceContent: SAMPLE,
    projectDir: packageDir,
  });

  if (recorded.size === 0) {
    throw new Error(
      "Recorded no XSL files. The mount reader hook is not being used — " +
        "check that dist/ is current (npm run build).",
    );
  }

  // Sorted so the artifact is byte-stable across runs and diffs cleanly.
  const sorted = Object.fromEntries(
    [...recorded.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  const json = JSON.stringify(sorted);
  await writeFile(outputPath, json, "utf8");

  const bytes = Buffer.byteLength(json);
  console.log(
    `Wrote ${path.relative(packageDir, outputPath)}: ` +
      `${recorded.size} files, ${(bytes / 1024).toFixed(0)}KB ` +
      `(one request instead of ${recorded.size}).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
