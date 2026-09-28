// Download latest schema files into packages/vscode-extension/assets/schema.
// Usage:
//   node ./scripts/getSchemas.js
//   node ./scripts/getSchemas.js --only-pretext-dev
//
// By default the schemas come from the tips of pretext-cli `main` and pretext
// `master`. To pin them to what a particular CLI release builds with, set
//   PRETEXT_CLI_REF   pretext-cli branch/tag/commit (e.g. v2.54.0)
//   PRETEXT_CORE_REF  pretext branch/tag/commit (the CLI's CORE_COMMIT)
// The release workflow does this when it syncs to a new CLI release.

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, "..", "packages", "vscode-extension", "assets", "schema");

const cliRef = process.env.PRETEXT_CLI_REF || "refs/heads/main";
const coreRef = process.env.PRETEXT_CORE_REF || "refs/heads/master";
const cliBase = `https://raw.githubusercontent.com/PreTeXtBook/pretext-cli/${cliRef}/schema`;
const coreBase = `https://raw.githubusercontent.com/PreTeXtBook/pretext/${coreRef}/schema`;

const schemaUrls = [
  `${cliBase}/project-ptx.rng`,
  `${coreBase}/publication-schema.rng`,
  `${coreBase}/pretext.rng`,
  // pf-adapter.rng, pf-preamble-adapter.rng, and pf_schema.rng are required by pretext.rng
  // via <externalRef> and <include> elements for PreFigure diagram support.
  `${coreBase}/pf-adapter.rng`,
  `${coreBase}/pf-preamble-adapter.rng`,
  `${coreBase}/pf_schema.rng`,
  `${coreBase}/pretext-dev.rng`,
];

function shouldDownload(url) {
  if (process.argv.includes("--only-pretext-dev")) {
    return url.endsWith("/pretext-dev.rng");
  }
  return true;
}

function downloadToFile(url, destination) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(`Failed to download ${url} (status ${response.statusCode})`),
          );
          return;
        }

        const file = fs.createWriteStream(destination);
        response.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve());
        });
        file.on("error", (error) => {
          reject(error);
        });
      })
      .on("error", (error) => {
        reject(error);
      });
  });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const urls = schemaUrls.filter(shouldDownload);
  for (const url of urls) {
    const filename = path.basename(url);
    const destination = path.join(outputDir, filename);
    await downloadToFile(url, destination);
    console.log(`Downloaded ${filename}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
