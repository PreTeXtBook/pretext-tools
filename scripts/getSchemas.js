// Download latest schema files into extension/assets/schema.
// Usage:
//   node ./scripts/getSchemas.js
//   node ./scripts/getSchemas.js --only-pretext-dev

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, "..", "extension", "assets", "schema");

const schemaUrls = [
  "https://raw.githubusercontent.com/PreTeXtBook/pretext-cli/refs/heads/main/schema/project-ptx.rng",
  "https://raw.githubusercontent.com/PreTeXtBook/pretext/refs/heads/master/schema/publication-schema.rng",
  "https://raw.githubusercontent.com/PreTeXtBook/pretext/refs/heads/master/schema/pretext.rng",
  "https://raw.githubusercontent.com/PreTeXtBook/pretext/refs/heads/master/schema/pretext-dev.rng",
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
