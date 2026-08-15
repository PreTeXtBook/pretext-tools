// Attaches the cleaning record to the files an import produces.
//
// Cleaning happens in LaTeX, files are cut in PreTeXt, and unified-latex sits
// between the two with no offset correspondence. The join is the division
// title: `clean-chunks.ts` records the heading each chunk came from, and every
// division in the pool carries the title it converted to.

import { mergeChunksAtLevel, type CleanedChunk } from "./clean/clean-chunks";
import {
  diffHunks,
  diffLines,
  diffStats,
  type DiffHunk,
  type DiffStats,
} from "./diff";
import { serializeProjectToFiles } from "./pool";
import type { ImportedProjectSuccess } from "./types";

export interface FileChangeRecord {
  path: string;
  /** Division title this file holds, or `""` for the main file. */
  title: string;
  before: string;
  after: string;
  stats: DiffStats;
  hunks: DiffHunk[];
  /** Number of cleaning fixes applied within this file's source. */
  fixCount: number;
}

/**
 * A before/after record for each generated source file at `splitLevel`.
 *
 * Files with no matching chunk are omitted rather than shown with an empty
 * diff: a title that did not survive conversion means the join is unreliable
 * for that file, and an empty diff would read as "nothing changed here" when
 * the truth is "we do not know".
 */
export function fileChangesForImport(
  result: ImportedProjectSuccess,
  splitLevel: number = result.splitLevel,
): FileChangeRecord[] {
  if (result.cleanChunks.length === 0) return [];

  const merged = mergeChunksAtLevel(result.cleanChunks, splitLevel);
  const byTitle = indexUniqueTitles(merged);

  const { pathByRef } = serializeProjectToFiles(result.project, {
    mainSourcePath: result.projectLayout.mainSourcePath,
    publicationPath: result.projectLayout.publicationPath,
    projectFilePath: result.projectLayout.projectFilePath,
    includeScaffold: !result.projectLayout.preserved,
  });

  const records: FileChangeRecord[] = [];
  for (const division of result.project.divisions) {
    const path = pathByRef[division.xmlId];
    if (!path) continue;
    const chunk = division.isRoot
      ? merged.find((c) => c.kind === "preamble" || c.kind === "lead")
      : byTitle.get(division.title);
    if (!chunk) continue;

    const lines = diffLines(chunk.before, chunk.after);
    records.push({
      path,
      title: division.title,
      before: chunk.before,
      after: chunk.after,
      stats: diffStats(lines),
      hunks: diffHunks(lines),
      fixCount: chunk.fixes.length,
    });
  }

  return records.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Index chunks by title, dropping any title that appears more than once.
 *
 * Two divisions called "Exercises" cannot be told apart by title, and guessing
 * would show the author one division's changes under another's name.
 */
function indexUniqueTitles(chunks: CleanedChunk[]): Map<string, CleanedChunk> {
  const seen = new Map<string, CleanedChunk | null>();
  for (const chunk of chunks) {
    if (chunk.kind !== "division" || !chunk.title) continue;
    seen.set(chunk.title, seen.has(chunk.title) ? null : chunk);
  }
  const unique = new Map<string, CleanedChunk>();
  for (const [title, chunk] of seen) {
    if (chunk) unique.set(title, chunk);
  }
  return unique;
}
