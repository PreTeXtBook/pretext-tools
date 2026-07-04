import { convertRNGToPattern, writeTreeToJSON } from "salve-annos";
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
