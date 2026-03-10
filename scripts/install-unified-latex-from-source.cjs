#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const sourceArg = process.argv[2];

if (!sourceArg) {
  console.error("Usage: node scripts/install-unified-latex-from-source.cjs <path-to-unified-latex-repo>");
  process.exit(1);
}

const sourceRoot = path.resolve(repoRoot, sourceArg);
const requiredPackages = [
  "structured-clone",
  "unified-latex-util-pegjs",
  "unified-latex-util-ligatures",
  "unified-latex",
  "unified-latex-to-pretext",
];

const packagePaths = requiredPackages.map((pkg) => ({
  pkg,
  path: path.join(sourceRoot, "packages", pkg),
}));

if (!fs.existsSync(path.join(sourceRoot, "package.json"))) {
  console.error(`Cannot find package.json in source repo: ${sourceRoot}`);
  process.exit(1);
}

for (const item of packagePaths) {
  if (!fs.existsSync(path.join(item.path, "package.json"))) {
    console.error(`Source repo is missing expected package: ${item.pkg}`);
    process.exit(1);
  }
}

const packedDir = path.join(repoRoot, "tmp", "unified-latex-packs");
fs.rmSync(packedDir, { recursive: true, force: true });
fs.mkdirSync(packedDir, { recursive: true });

const run = (command, cwd) => {
  execSync(command, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CI: process.env.CI || "true" },
  });
};

console.log(`Using unified-latex source at: ${sourceRoot}`);

run("npm install", sourceRoot);
run(
  "npm run build -w @unified-latex/structured-clone -w @unified-latex/unified-latex-util-pegjs -w @unified-latex/unified-latex-util-ligatures -w @unified-latex/unified-latex -w @unified-latex/unified-latex-to-pretext",
  sourceRoot
);
run(
  "npm run package -w @unified-latex/structured-clone -w @unified-latex/unified-latex-util-pegjs -w @unified-latex/unified-latex-util-ligatures -w @unified-latex/unified-latex -w @unified-latex/unified-latex-to-pretext",
  sourceRoot
);

for (const item of packagePaths) {
  run(`npm pack --pack-destination \"${packedDir}\"`, path.join(item.path, "dist"));
}

const tarballs = fs
  .readdirSync(packedDir)
  .filter((file) => file.endsWith(".tgz"))
  .map((file) => path.join(packedDir, file));

if (tarballs.length < 2) {
  console.error(`Expected at least 2 tarballs in ${packedDir}, found ${tarballs.length}.`);
  process.exit(1);
}

run(`npm install --no-save ${tarballs.map((p) => `\"${p}\"`).join(" ")}`, repoRoot);

console.log("Installed unified-latex packages from source tarballs.");
