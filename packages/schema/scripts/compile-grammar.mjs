// Precompile the PreTeXt RELAX NG schemas to salve JSON grammar trees.
//
// Reads the .rng files shipped with the VS Code extension and writes matching
// .json grammar files next to them (loaded at LSP startup via
// loadGrammarFromJSON) and into this package's assets/ directory.
//
// Usage: node ./scripts/compile-grammar.mjs
//
// Run automatically by the root `refresh:schemas` script after the .rng files
// are refreshed from upstream.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { convertRNGToPattern, writeTreeToJSON } from "salve-annos";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../../..");
const extensionSchemaDir = path.join(
  workspaceRoot,
  "packages",
  "vscode-extension",
  "assets",
  "schema",
);
const packageAssetsDir = path.join(scriptDir, "..", "assets");

// [rng filename, whether a failure is fatal to the build]
// Note: pretext-dev.rng has upstream dangling refs and causes build hangs; removed.
// LSP falls back to stable pretext.json if pretext-dev.json is unavailable.
const targets = [["pretext.rng", true]];

async function compileOne(rngName, fatal) {
  const rngPath = path.join(extensionSchemaDir, rngName);
  if (!fs.existsSync(rngPath)) {
    console.warn(`Skipping ${rngName}: not found at ${rngPath}`);
    return;
  }
  try {
    const result = await convertRNGToPattern(pathToFileURL(rngPath));
    for (const warning of result.warnings ?? []) {
      console.warn(`  [${rngName}] warning: ${warning}`);
    }
    const json = writeTreeToJSON(result.simplified, 3);
    const outName = rngName.replace(/\.rng$/, ".json");

    fs.mkdirSync(packageAssetsDir, { recursive: true });
    fs.writeFileSync(path.join(extensionSchemaDir, outName), json);
    fs.writeFileSync(path.join(packageAssetsDir, outName), json);
    console.log(
      `Compiled ${rngName} -> ${outName} (${(json.length / 1024) | 0} KB)`,
    );
  } catch (error) {
    const message = `Failed to compile ${rngName}: ${error?.message ?? error}`;
    if (fatal) {
      throw new Error(message);
    }
    console.warn(`  ${message} (non-fatal; likely dangling refs upstream)`);
  }
}

async function main() {
  for (const [name, fatal] of targets) {
    await compileOne(name, fatal);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
