import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadGrammarFromJSON } from '../grammar';
import type { Grammar } from '../types';

const here = path.dirname(fileURLToPath(import.meta.url));

let cached: Grammar | undefined;

/** Load the precompiled stable PreTeXt grammar (from assets/pretext.json). */
export function testGrammar(): Grammar {
  if (!cached) {
    const json = fs.readFileSync(
      path.resolve(here, '../../assets/pretext.json'),
      'utf8',
    );
    cached = loadGrammarFromJSON(json);
  }
  return cached;
}

export const fixturesDir = path.resolve(here, 'fixtures');
