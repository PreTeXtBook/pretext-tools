// Regenerates `src/data/converter-support.json` — a snapshot of everything
// `@pretextbook/unified-latex-to-pretext` will convert.
//
// The curated tables in `src/data/` are hand-written: they carry snippets,
// documentation, nesting hints and editorial judgment the converter has no
// opinion about. But *which names exist* is the converter's call, not ours, and
// letting that drift is how the tables went stale. So the converter's surface is
// snapshotted here, committed, and checked two ways:
//
//   - `npm run refresh:latex-support` rewrites the snapshot from the installed
//     converter. A diff means upstream's support surface moved.
//   - `converter-coverage.spec.ts` asserts the curated tables cover the
//     snapshot, naming any entry that needs adding (or explicitly waiving).
//
// Run with `--check` to fail instead of writing, which is what CI does.
//
// The surface comes from two places, because the converter only exports half of
// it:
//
//   1. `environments` / `macros` / `plusMacros` / `defaultPlusTypes` — the
//      PreTeXt-specific additions, exported as info records with signatures.
//   2. Ordinary LaTeX and PreTeXt inline markup (`\alert`, `\emph`, `\q`, …)
//      handled through internal replacement tables the converter does *not*
//      export. Those are found by probing: every PreTeXt element name from the
//      schema is converted as `\name{x}` and as an environment, and whatever
//      does not come back with an "Unknown macro/environment" message is
//      supported. This is how `\alert` was found missing.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { processLatexViaUnified } from "@unified-latex/unified-latex";
import {
  environments,
  macros,
  plusMacros,
  defaultPlusTypes,
  unifiedLatexToPretext,
  xmlCompilePlugin,
} from "@pretextbook/unified-latex-to-pretext";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const outputPath = resolve(here, "../src/data/converter-support.json");

const converterVersion = JSON.parse(
  readFileSync(
    resolve(
      repoRoot,
      "node_modules/@pretextbook/unified-latex-to-pretext/package.json",
    ),
    "utf8",
  ),
).version;

/** Keep only the fields the curated tables are checked against. */
function signatures(record) {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((name) => [name, record[name].signature ?? ""]),
  );
}

/**
 * Every PreTeXt element name, read out of the generated schema table.
 *
 * Read as text rather than imported: the file is TypeScript and this script is
 * plain Node. The shape is generated and stable (`  "name": {`), so a regex over
 * the top-level keys is safe enough, and the count assertion below catches it if
 * that ever stops being true.
 */
function pretextElementNames() {
  const source = readFileSync(
    resolve(repoRoot, "packages/ptxast/src/types/generated.ts"),
    "utf8",
  );
  const names = [...source.matchAll(/^ {2}"([a-zA-Z][\w-]*)": \{/gm)].map(
    (m) => m[1],
  );
  if (names.length < 100) {
    throw new Error(
      `Only found ${names.length} PreTeXt element names in ptxast/src/types/generated.ts — ` +
        "the generated shape changed and this probe needs updating.",
    );
  }
  return names;
}

/**
 * The converter pipeline, assembled here rather than imported from
 * `@pretextbook/latex-pretext`.
 *
 * This is deliberate: that package's entry point re-exports a `dist/` build
 * artifact, so importing it would make this script — and the CI check that runs
 * it — depend on `build:libs` having run first. It also meant a stale `dist/`
 * could snapshot an old converter and pass, which is the "green and wrong"
 * failure the snapshot exists to prevent.
 *
 * The snapshot's job is to record what *upstream* supports, so it goes straight
 * to upstream. `converter-drift.spec.ts` still imports the workspace wrapper and
 * covers the other direction: what our pipeline actually converts.
 */
function latexToPretext(latex) {
  return processLatexViaUnified()
    .use(unifiedLatexToPretext, { producePretextFragment: true })
    .use(xmlCompilePlugin)
    .processSync({ value: latex });
}

function convertsCleanly(latex, kind) {
  const pattern = kind === "macro" ? /^Unknown macro/ : /^Unknown environment/;
  try {
    return !latexToPretext(latex).messages.some((m) => pattern.test(m.message));
  } catch {
    return false;
  }
}

/** PreTeXt element names the converter accepts as `\name{...}`. */
function probeMacros(names) {
  return names
    .filter((name) => /^[a-zA-Z]+$/.test(name))
    .filter((name) => convertsCleanly(`\\${name}{x}`, "macro"))
    .sort();
}

/** PreTeXt element names the converter accepts as `\begin{name}...\end{name}`. */
function probeEnvironments(names) {
  return names
    .filter((name) =>
      convertsCleanly(`\\begin{${name}}\nx\n\\end{${name}}`, "environment"),
    )
    .sort();
}

const elementNames = pretextElementNames();

const snapshot = {
  $comment:
    "Generated by scripts/refresh-converter-support.mjs — do not edit by hand. " +
    "Run `npm run refresh:latex-support` after bumping @pretextbook/unified-latex-to-pretext.",
  converterVersion,
  environments: signatures(environments),
  macros: signatures(macros),
  plusMacros: signatures(plusMacros),
  plusTypes: [...defaultPlusTypes].sort(),
  probedMacros: probeMacros(elementNames),
  probedEnvironments: probeEnvironments(elementNames),
};

const serialized = JSON.stringify(snapshot, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== serialized) {
    console.error(
      "converter-support.json is out of date.\n" +
        "Run `npm run refresh:latex-support`, then reconcile the curated tables\n" +
        "in packages/latex-style-pretext/src/data/ (the coverage spec names what changed).",
    );
    process.exit(1);
  }
  console.log(`converter-support.json matches converter ${converterVersion}.`);
} else {
  writeFileSync(outputPath, serialized);
  console.log(
    `Wrote converter-support.json for converter ${converterVersion}:\n` +
      `  declared: ${Object.keys(snapshot.environments).length} environments, ` +
      `${Object.keys(snapshot.macros).length} macros, ${snapshot.plusTypes.length} plus types\n` +
      `  probed:   ${snapshot.probedMacros.length} macros, ` +
      `${snapshot.probedEnvironments.length} environments ` +
      `(from ${elementNames.length} PreTeXt element names)`,
  );
}
