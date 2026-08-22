// Host-side helpers for consuming an ImportedProjectSuccess. Every host
// (the VS Code webview, pretext-plus, the playground demo) and the wizard's
// own preview resolve the user's mode choice through these, so "what gets
// written" is defined in exactly one place.

import type { CleaningWarning } from "./clean/warnings";
import type { ImportedProject, ImportedProjectSuccess } from "./types";

/** Which of the result's alternatives the user chose to import. */
export type ImportMode = "converted" | "native";

/**
 * The mode a host gets when it expresses no preference: convert to PreTeXt.
 * Exported so consumers that surface their own default (a VS Code setting, a
 * pretext-plus account preference) can name this one rather than re-spelling
 * the string literal.
 */
export const DEFAULT_IMPORT_MODE: ImportMode = "converted";

/**
 * Does this result actually carry a native alternative? Only LaTeX and
 * Markdown imports produce one — a PreTeXt upload has nothing to keep — so a
 * host or UI that offers the choice should ask this first rather than keying
 * off the detected format.
 */
export function hasNativeImportMode(result: ImportedProjectSuccess): boolean {
  return result.nativeOutputFiles !== undefined;
}

/**
 * The mode that will really be applied to this result, given a preference.
 * A preferred `"native"` collapses to `"converted"` when the result has no
 * native projection, which keeps the mode a host reports (and stores) in step
 * with the files it actually writes — the `*ForImportMode` helpers fall back
 * silently on their own.
 */
export function resolveImportMode(
  result: ImportedProjectSuccess,
  preferred: ImportMode = DEFAULT_IMPORT_MODE,
): ImportMode {
  return preferred === "native" && !hasNativeImportMode(result)
    ? "converted"
    : preferred;
}

/**
 * The division pool the pretext-plus host should serialize for the chosen
 * mode: the native (LaTeX/Markdown) pool when the user keeps the source
 * format, otherwise the converted PreTeXt pool. Falls back to the converted
 * pool when there is no native projection (e.g. PreTeXt input, or an import
 * that produced no native source).
 */
export function projectForImportMode(
  result: ImportedProjectSuccess,
  mode: ImportMode,
): ImportedProject {
  return mode === "native"
    ? (result.nativeProject ?? result.project)
    : result.project;
}

/** The text files a host should write for the chosen mode. */
export function filesForImportMode(
  result: ImportedProjectSuccess,
  mode: ImportMode,
): Record<string, string> {
  return mode === "converted"
    ? result.outputFiles
    : (result.nativeOutputFiles ?? result.files);
}

/** The binary assets a host should write for the chosen mode. */
export function assetsForImportMode(
  result: ImportedProjectSuccess,
  mode: ImportMode,
): Record<string, Uint8Array> {
  return mode === "converted" ? result.outputAssets : result.assets;
}

/**
 * One-line human-readable rendering of a cleaning warning, for plain-text
 * surfaces (VS Code's output channel, logs).
 */
export function formatWarningLine(warning: CleaningWarning): string {
  const detail =
    warning.action === "replace" || warning.action === "rewrite"
      ? `replaced with \`${warning.replacement}\``
      : (warning.message ?? warning.action);
  const times = warning.occurrences > 1 ? ` (x${warning.occurrences})` : "";
  return `[${warning.severity}] ${warning.macro}: ${detail}${times}`;
}
