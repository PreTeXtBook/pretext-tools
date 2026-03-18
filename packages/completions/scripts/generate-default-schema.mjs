// This script is deprecated.  The PreTeXt schema is now generated and maintained
// in packages/schema.  Run `packages/schema/scripts/generate-schema.mjs` instead,
// or use `npm run refresh:schemas` from the workspace root.

import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const newScript = path.resolve(scriptDir, "../../schema/scripts/generate-schema.mjs");

console.warn(
  "[DEPRECATED] generate-default-schema.mjs is deprecated. " +
    "Delegating to packages/schema/scripts/generate-schema.mjs instead.",
);

execFileSync(process.execPath, [newScript], { stdio: "inherit" });
