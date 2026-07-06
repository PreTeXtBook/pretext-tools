import { readTreeFromJSON } from "salve-annos";
import type { Grammar } from "./types";

/**
 * Reconstruct a salve {@link Grammar} from a precompiled JSON tree (as produced
 * by `writeTreeToJSON` at schema-refresh time). This is the runtime entry point:
 * it is fast (~25 ms for the PreTeXt grammar) and, unlike {@link
 * "./compile"}, does not pull in salve's RNG-conversion machinery.
 */
export function loadGrammarFromJSON(json: string): Grammar {
  return readTreeFromJSON(json) as unknown as Grammar;
}
