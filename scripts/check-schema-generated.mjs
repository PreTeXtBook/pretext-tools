import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("node", ["./packages/completions/scripts/generate-default-schema.mjs"]);

const trackedGeneratedFiles = [
  "packages/completions/src/default-dev-schema.ts",
  "packages/ptxast/src/types/generated.ts",
];

const diffResult = spawnSync(
  "git",
  ["diff", "--exit-code", "--", ...trackedGeneratedFiles],
  {
    stdio: "inherit",
  },
);

if (diffResult.status !== 0) {
  console.error(
    "Generated schema artifacts are out of date. Run schema generation and commit updated files.",
  );
  process.exit(diffResult.status ?? 1);
}

console.log("Schema-generated artifacts are up to date.");
