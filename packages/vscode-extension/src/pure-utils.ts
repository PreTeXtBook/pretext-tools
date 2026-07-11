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
