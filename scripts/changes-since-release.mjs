#!/usr/bin/env node
/**
 * Shows commits per package since its last release tag.
 * Handles both old tag format (format-v0.0.6) and changesets format (@pretextbook/format@0.0.7).
 *
 * Usage: node scripts/changes-since-release.mjs [package-name]
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(cmd) {
  return execSync(`git -C "${root}" ${cmd}`, { encoding: "utf8" }).trim();
}

const allTags = git("tag").split("\n").filter(Boolean);

// Package dir name → { npmName, tagPrefixes (old format, in priority order) }
const packages = [
  {
    dir: "format",
    name: "@pretextbook/format",
    oldPrefix: "format-v",
  },
  {
    dir: "completions",
    name: "@pretextbook/completions",
    oldPrefix: "completions-v",
  },
  {
    dir: "latex-pretext",
    name: "@pretextbook/latex-pretext",
    oldPrefix: "latex-pretext-v",
  },
  {
    dir: "ptxast",
    name: "@pretextbook/ptxast",
    oldPrefix: "ptxast-v",
  },
  {
    dir: "remark-pretext",
    name: "@pretextbook/remark-pretext",
    oldPrefix: "ptxast-v", // released together with ptxast
  },
  {
    dir: "ptxast-util-to-mdast",
    name: "@pretextbook/ptxast-util-to-mdast",
    oldPrefix: "ptxast-v",
  },
  {
    dir: "visual-editor",
    name: "@pretextbook/visual-editor",
    oldPrefix: "visual-editor-v",
  },
  {
    dir: "vscode-extension",
    name: "pretext-tools",
    oldPrefix: "v",
  },
];

const filter = process.argv[2]; // optional: filter to one package by dir name or npm name

function latestTag(pkg) {
  // Prefer changesets-style tag, fall back to old prefix
  const changesetsTag = `${pkg.name}@`;
  const candidates = allTags
    .filter((t) => {
      if (t.startsWith(changesetsTag)) return /\d/.test(t.slice(changesetsTag.length));
      if (pkg.oldPrefix && t.startsWith(pkg.oldPrefix))
        return /\d/.test(t.slice(pkg.oldPrefix.length));
      return false;
    })
    .sort((a, b) => {
      // Sort by version number descending
      const ver = (t) =>
        t
          .replace(/.*@/, "")
          .replace(/.*-v/, "")
          .replace(/^v/, "")
          .split(".")
          .map(Number);
      const [av, bv] = [ver(a), ver(b)];
      for (let i = 0; i < 3; i++) {
        if ((av[i] ?? 0) !== (bv[i] ?? 0)) return (bv[i] ?? 0) - (av[i] ?? 0);
      }
      return 0;
    });
  return candidates[0] ?? null;
}

function localVersion(dir) {
  try {
    const pkgJson = JSON.parse(
      readFileSync(resolve(root, "packages", dir, "package.json"), "utf8"),
    );
    return pkgJson.version;
  } catch {
    return "?";
  }
}

const filtered = filter
  ? packages.filter((p) => p.dir === filter || p.name === filter)
  : packages;

for (const pkg of filtered) {
  const tag = latestTag(pkg);
  const version = localVersion(pkg.dir);
  const tagRange = tag ? `${tag}..HEAD` : "HEAD";
  const since = tag ?? "(no prior release tag)";

  const log = git(
    `log ${tagRange} --oneline --no-merges -- packages/${pkg.dir}/`,
  );

  const tagNote = tag
    ? `last release: ${tag}`
    : "no prior release — showing all commits";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📦 ${pkg.name}  (local: ${version})  ${tagNote}`);
  console.log("─".repeat(60));
  if (log) {
    console.log(log);
  } else {
    console.log("  (no commits since last release)");
  }
}
console.log();
