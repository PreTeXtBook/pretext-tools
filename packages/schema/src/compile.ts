import { convertRNGToPattern, writeTreeToJSON } from "salve-annos";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { loadGrammarFromJSON } from "./grammar";
import type { Grammar } from "./types";

/**
 * NOTE: This module imports salve's RNG-conversion machinery, which depends on
 * Node-only packages (`file-url`, `temp`). It is intended for build-time schema
 * precompilation and tests only — do **not** import it from code that runs in
 * the shipped LSP bundle. Load precompiled grammars with
 * {@link loadGrammarFromJSON} instead.
 */

// salve-annos bug workaround: InternalSimplifier.parse is passed to step1 as a
// Parser callback (filePath: URL) => Promise<Element>, but the implementation
// expects three arguments (filePath, schemaResource, schemaText). When step1
// calls parse(url) for externalRef/include elements, schemaText is undefined,
// causing a crash. Patch the prototype to load the resource when schemaText is
// not supplied.
{
  const _require = createRequire(import.meta.url);
  const internal = _require(
    "salve-annos/lib/salve/conversion/schema-simplifiers/internal.js",
  ) as { InternalSimplifier: { prototype: { parse: Function } } };
  const origParse = internal.InternalSimplifier.prototype.parse;
  if (origParse.name !== "patchedParse") {
    internal.InternalSimplifier.prototype.parse = async function patchedParse(
      filePath: URL,
      schemaResource: unknown,
      schemaText: string | undefined,
    ) {
      if (schemaText === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (this as any).options.resourceLoader.load(filePath);
        schemaResource = res;
        schemaText = (await res.getText()) as string;
      }
      return origParse.call(this, filePath, schemaResource, schemaText);
    };
  }
}

export interface CompileResult {
  /** The precompiled grammar tree serialized to JSON. */
  json: string;
  /** Warnings emitted by salve during conversion (e.g. dangling refs). */
  warnings: string[];
}

/**
 * Convert a RELAX NG schema file to a precompiled JSON grammar tree. Resolves
 * `<include>` directives via a `file://` resource loader.
 */
export async function compileRngToJSON(rngPath: string): Promise<CompileResult> {
  const result = await convertRNGToPattern(pathToFileURL(rngPath));
  const warnings = (result.warnings ?? []).map((w) => String(w));
  const json = writeTreeToJSON(result.simplified, 3);
  return { json, warnings };
}

/** Convenience: compile a RNG file straight to a usable {@link Grammar}. */
export async function compileRngToGrammar(rngPath: string): Promise<Grammar> {
  const { json } = await compileRngToJSON(rngPath);
  return loadGrammarFromJSON(json);
}
