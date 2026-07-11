// Host-side helpers for consuming an ImportedProjectSuccess. Every host
// (the VS Code webview, pretext-plus, the playground demo) and the wizard's
// own preview resolve the user's mode choice through these, so "what gets
// written" is defined in exactly one place.

import type { CleaningWarning } from './clean/warnings';
import type { ImportedProjectSuccess } from './types';

/** Which of the result's alternatives the user chose to import. */
export type ImportMode = 'converted' | 'native';

/** The text files a host should write for the chosen mode. */
export function filesForImportMode(
  result: ImportedProjectSuccess,
  mode: ImportMode,
): Record<string, string> {
  return mode === 'converted'
    ? result.outputFiles
    : (result.nativeOutputFiles ?? result.files);
}

/** The binary assets a host should write for the chosen mode. */
export function assetsForImportMode(
  result: ImportedProjectSuccess,
  mode: ImportMode,
): Record<string, Uint8Array> {
  return mode === 'converted' ? result.outputAssets : result.assets;
}

/**
 * One-line human-readable rendering of a cleaning warning, for plain-text
 * surfaces (VS Code's output channel, logs).
 */
export function formatWarningLine(warning: CleaningWarning): string {
  const detail =
    warning.action === 'replace' || warning.action === 'rewrite'
      ? `replaced with \`${warning.replacement}\``
      : (warning.message ?? warning.action);
  const times = warning.occurrences > 1 ? ` (x${warning.occurrences})` : '';
  return `[${warning.severity}] ${warning.macro}: ${detail}${times}`;
}
