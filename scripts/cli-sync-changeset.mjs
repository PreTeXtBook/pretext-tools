// Write a changeset for a sync to a new pretext-cli release.
//
// Usage:
//   node ./scripts/cli-sync-changeset.mjs <cli-version> <core-commit>
//
// Looks at the working tree (after `refresh:schemas` and `refresh:xsl` have
// run), finds every publishable package with changed files, and writes one
// patch changeset naming them. Prints the package names, one per line; prints
// nothing, and writes nothing, when no publishable package changed.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [cliVersion, coreCommit] = process.argv.slice(2);
if (!cliVersion || !coreCommit) {
  console.error("Usage: cli-sync-changeset.mjs <cli-version> <core-commit>");
  process.exit(2);
}

const changed = execFileSync(
  "git",
  // core.fileMode=false: `npm install` sets the exec bit on package bins,
  // which is not a change worth releasing.
  [
    "-c",
    "core.fileMode=false",
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "packages",
  ],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .map((line) => line.slice(3).split(" -> ").pop());

const ignored = new Set(
  JSON.parse(fs.readFileSync(path.join(root, ".changeset", "config.json")))
    .ignore,
);

const names = new Set();
for (const file of changed) {
  const dir = file.split("/").slice(0, 2).join("/");
  const manifest = path.join(root, dir, "package.json");
  if (!fs.existsSync(manifest)) {
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (!pkg.private && !ignored.has(pkg.name)) {
    names.add(pkg.name);
  }
}

if (names.size > 0) {
  const sorted = [...names].sort();
  const frontmatter = sorted.map((name) => `"${name}": patch`).join("\n");
  const body =
    `Sync PreTeXt schemas and XSL to pretext-cli v${cliVersion} ` +
    `(core commit ${coreCommit.slice(0, 7)}).`;
  fs.writeFileSync(
    path.join(root, ".changeset", `pretext-cli-v${cliVersion}.md`),
    `---\n${frontmatter}\n---\n\n${body}\n`,
  );
  console.log(sorted.join("\n"));
}
