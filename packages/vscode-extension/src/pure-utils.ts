import * as path from "path";
import * as fs from "fs";
import { SpellCheckScope } from "./types";

/**
 * Pure, `vscode`-free helpers extracted from `utils.ts` so they can be unit
 * tested in plain Node. `utils.ts` re-exports these for existing callers.
 */

/**
 * Walk up the directory tree looking for a folder that contains a
 * `project.ptx` manifest.
 * @returns the first ancestor directory (inclusive) containing `project.ptx`,
 * or `null` if the filesystem root is reached without finding one.
 */
export function getProjectFolder(dirPath: string): string | null {
  if (dirPath === path.dirname(dirPath)) {
    return null;
  } else if (fs.existsSync(path.join(dirPath, "project.ptx"))) {
    return dirPath;
  } else {
    return getProjectFolder(path.dirname(dirPath));
  }
}

/** Strip ANSI color/escape codes from a string (e.g. from CLI output). */
export function stripColorCodes(input: string): string {
  // eslint-disable-next-line no-control-regex
  const regex = /\x1B\[[0-9;]*m/g;
  return input.replace(regex, "");
}

/**
 * Build the list of `cSpell` ignore regexes for the scopes the user has marked
 * as "Ignore". Each PreTeXt construct (comments, math, code, ...) maps to a
 * regex that removes its contents from spell checking.
 */
export function buildSpellCheckIgnorePatterns(
  scopes: SpellCheckScope | undefined,
): string[] {
  const ignorePatterns: string[] = [];
  if (!scopes) {
    return ignorePatterns;
  }
  if (scopes.comments === "Ignore") {
    ignorePatterns.push("<!--.*?-->");
  }
  if (scopes.inlineMath === "Ignore") {
    ignorePatterns.push("<m>.*?</m>");
  }
  if (scopes.displayMath === "Ignore") {
    ignorePatterns.push("<(me|men|md|mdn)>(.|\n|\r|\n\r)*?</(me|men|md|mdn)>");
  }
  if (scopes.inlineCode === "Ignore") {
    ignorePatterns.push("<c>.*?</c>");
  }
  if (scopes.blockCode === "Ignore") {
    ignorePatterns.push(
      "<(program|sage|pre)>(.|\n|\r|\n\r)*?</(program|sage|pre)>",
    );
  }
  if (scopes.latexImage === "Ignore") {
    ignorePatterns.push("<latex-image>(.|\n|\r|\n\r)*?</latex-image>");
  }
  if (scopes.tags === "Ignore") {
    ignorePatterns.push("<[^!].*?>");
  }
  return ignorePatterns;
}

/** A single cSpell `languageSettings` entry (only the fields we touch). */
type CSpellLanguageSetting = {
  languageId?: unknown;
  ignoreRegExpList?: unknown;
  [key: string]: unknown;
};

/**
 * Merge the PreTeXt ignore regexes into cSpell's `languageSettings` array.
 *
 * Updates the existing `pretext` entry's `ignoreRegExpList` if one is present,
 * otherwise appends a fresh entry. Previously the extension relied on a static
 * `cSpell.languageSettings` default in the manifest to seed this entry; that
 * default was removed, so we must create the entry when it is missing or cSpell
 * never learns to skip PreTeXt tags/math/code. Returns a new array and does not
 * mutate the input (which may be `undefined` before cSpell has any config).
 */
export function upsertPretextLanguageSettings(
  languageSettings: unknown,
  ignorePatterns: string[],
): CSpellLanguageSetting[] {
  const existing: CSpellLanguageSetting[] = Array.isArray(languageSettings)
    ? (languageSettings as CSpellLanguageSetting[])
    : [];
  let found = false;
  const next = existing.map((entry) => {
    if (entry && entry.languageId === "pretext") {
      found = true;
      return { ...entry, ignoreRegExpList: ignorePatterns };
    }
    return entry;
  });
  if (!found) {
    next.push({ languageId: "pretext", ignoreRegExpList: ignorePatterns });
  }
  return next;
}
