import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadGrammarFromJSON } from "../grammar";
import type { Grammar } from "../types";

const here = path.dirname(fileURLToPath(import.meta.url));

const cache = new Map<string, Grammar>();

/** Load one of the precompiled grammars from assets/ by filename. */
function loadAsset(name: string): Grammar {
  let grammar = cache.get(name);
  if (!grammar) {
    const json = fs.readFileSync(
      path.resolve(here, "../../assets", name),
      "utf8",
    );
    grammar = loadGrammarFromJSON(json);
    cache.set(name, grammar);
  }
  return grammar;
}

/** Load the precompiled stable PreTeXt grammar (from assets/pretext.json). */
export function testGrammar(): Grammar {
  return loadAsset("pretext.json");
}

/** The `project.ptx` manifest grammar (from assets/project-ptx.json). */
export function projectGrammar(): Grammar {
  return loadAsset("project-ptx.json");
}

/** The publication-file grammar (from assets/publication-schema.json). */
export function publicationGrammar(): Grammar {
  return loadAsset("publication-schema.json");
}

export const fixturesDir = path.resolve(here, "fixtures");
