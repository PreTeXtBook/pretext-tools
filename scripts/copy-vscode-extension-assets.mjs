import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..");
const extensionRoot = path.join(workspaceRoot, "packages", "vscode-extension");
const distRoot = path.join(workspaceRoot, "dist", "vscode-extension");

const filesToCopy = [
  ["LICENSE", path.join(workspaceRoot, "LICENSE")],
  ["README.md", path.join(extensionRoot, "README.md")],
  ["logo.png", path.join(extensionRoot, "logo.png")],
  ["logo.svg", path.join(extensionRoot, "logo.svg")],
  [
    "language-configuration.json",
    path.join(extensionRoot, "language-configuration.json"),
  ],
  [
    "language-configuration-latex.json",
    path.join(extensionRoot, "language-configuration-latex.json"),
  ],
  [
    "language-configuration-markdown.json",
    path.join(extensionRoot, "language-configuration-markdown.json"),
  ],
  [".vscodeignore", path.join(extensionRoot, ".vscodeignore")],
];

const directoriesToCopy = ["assets", "snippets", "syntaxes"];

fs.mkdirSync(distRoot, { recursive: true });

const packageJsonPath = path.join(extensionRoot, "package.json");
const distPackageJsonPath = path.join(distRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

delete packageJson.scripts;
delete packageJson.devDependencies;

if (packageJson.dependencies) {
  delete packageJson.dependencies["@pretextbook/format"];
  delete packageJson.dependencies["@pretextbook/completions"];
  // bundled into out/lsp-server.js
  delete packageJson.dependencies["@pretextbook/latex-style-pretext"];
  delete packageJson.dependencies["@pretextbook/markdown-style-pretext"];
  // bundled into out/instant-preview-worker.mjs
  delete packageJson.dependencies["@pretextbook/pretext-html"];
}

fs.writeFileSync(
  distPackageJsonPath,
  `${JSON.stringify(packageJson, null, 2)}\n`,
);

for (const [relativeTarget, sourcePath] of filesToCopy) {
  fs.copyFileSync(sourcePath, path.join(distRoot, relativeTarget));
}

for (const relativeDir of directoriesToCopy) {
  const sourceDir = path.join(extensionRoot, relativeDir);
  const targetDir = path.join(distRoot, relativeDir);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

// Instant preview: the worker bundle (out/instant-preview-worker.mjs) needs
// the PreTeXt XSL assets (referenced via the PRETEXT_HTML_ASSETS env var) and
// the libxslt WASM binary (located via `new URL` relative to the bundle).
const pretextHtmlAssets = path.join(
  workspaceRoot,
  "packages",
  "pretext-html",
  "assets",
);
const pretextHtmlAssetsTarget = path.join(distRoot, "assets", "pretext-html");
fs.rmSync(pretextHtmlAssetsTarget, { recursive: true, force: true });
fs.cpSync(pretextHtmlAssets, pretextHtmlAssetsTarget, { recursive: true });

const wasmSource = path.join(
  workspaceRoot,
  "node_modules",
  "@pretextbook",
  "libxslt-wasm",
  "dist",
  "output",
  "libxslt.wasm",
);
fs.mkdirSync(path.join(distRoot, "out"), { recursive: true });
fs.copyFileSync(wasmSource, path.join(distRoot, "out", "libxslt.wasm"));
