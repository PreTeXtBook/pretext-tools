import { glob } from "glob";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const checkOnly = process.argv.includes("--check");
const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const rootPackageJsonPath = path.join(rootDir, "package.json");
const rootPackageJson = JSON.parse(await readFile(rootPackageJsonPath, "utf8"));
const workspacePatterns = Array.isArray(rootPackageJson.workspaces)
  ? rootPackageJson.workspaces
  : rootPackageJson.workspaces?.packages ?? [];

if (workspacePatterns.length === 0) {
  console.log("No workspaces found in package.json.");
  process.exit(0);
}

const packageJsonPaths = [];
for (const pattern of workspacePatterns) {
  const matches = await glob(path.posix.join(pattern, "package.json"), {
    cwd: rootDir,
    absolute: true,
  });
  packageJsonPaths.push(...matches);
}

const manifests = [];
for (const packageJsonPath of packageJsonPaths) {
  const manifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
  manifests.push({ path: packageJsonPath, manifest });
}

const internalVersions = new Map();
for (const { manifest } of manifests) {
  if (typeof manifest.name === "string" && typeof manifest.version === "string") {
    internalVersions.set(manifest.name, manifest.version);
  }
}

const shouldSkipRange = (range) =>
  range === "*" ||
  range.startsWith("workspace:") ||
  range.startsWith("file:") ||
  range.startsWith("link:") ||
  range.startsWith("github:") ||
  range.startsWith("git+") ||
  range.startsWith("http://") ||
  range.startsWith("https://");

const getUpdatedRange = (currentRange, nextVersion) => {
  if (currentRange.startsWith("^")) return `^${nextVersion}`;
  if (currentRange.startsWith("~")) return `~${nextVersion}`;
  if (/^\d+\.\d+\.\d+([-.+].*)?$/.test(currentRange)) return nextVersion;
  return `^${nextVersion}`;
};

const changedFiles = [];

for (const entry of manifests) {
  const pkg = entry.manifest;
  let changed = false;

  for (const sectionName of dependencySections) {
    const section = pkg[sectionName];
    if (!section || typeof section !== "object") continue;

    for (const [depName, depRange] of Object.entries(section)) {
      if (typeof depRange !== "string") continue;
      if (!internalVersions.has(depName)) continue;
      if (depName === pkg.name || shouldSkipRange(depRange)) continue;

      const nextRange = getUpdatedRange(depRange, internalVersions.get(depName));
      if (depRange !== nextRange) {
        section[depName] = nextRange;
        changed = true;
      }
    }
  }

  if (changed) {
    changedFiles.push(path.relative(rootDir, entry.path));
    if (!checkOnly) {
      await writeFile(entry.path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    }
  }
}

if (changedFiles.length === 0) {
  console.log("No internal dependency updates were needed.");
  process.exit(0);
}

console.log(
  `${checkOnly ? "Would update" : "Updated"} internal dependencies in ${changedFiles.length} package.json file(s):`,
);
for (const changedFile of changedFiles) {
  console.log(`- ${changedFile}`);
}
