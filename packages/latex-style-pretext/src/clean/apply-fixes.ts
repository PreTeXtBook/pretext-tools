// Applies `LatexFix`es to text, and runs the find/apply cycle to a fixpoint.

import type { TextEdit } from "vscode-languageserver-types";
import { rangeFromOffsets } from "../util/position";
import {
  findLatexFixes,
  type FindFixesOptions,
  type LatexFix,
} from "./find-fixes";

/**
 * Apply `fixes` to `text`. Only fixes with a `replacement` do anything; `flag`
 * fixes are reports and pass through untouched.
 *
 * Edits are spliced back-to-front so earlier offsets stay valid, and any fix
 * overlapping one already applied is skipped. `findLatexFixes` already returns
 * a non-overlapping set, so that guard only matters for hand-assembled lists —
 * a host applying one quick fix from a stale diagnostic, for instance.
 */
export function applyLatexFixes(
  text: string,
  fixes: LatexFix[],
): { output: string; applied: LatexFix[] } {
  const edits = fixes
    .filter((fix) => fix.replacement !== undefined)
    .sort((a, b) => b.start - a.start);

  const applied: LatexFix[] = [];
  let output = text;
  let lowestApplied = Number.POSITIVE_INFINITY;

  for (const fix of edits) {
    if (fix.end > lowestApplied) continue;
    output =
      output.slice(0, fix.start) + fix.replacement + output.slice(fix.end);
    applied.push(fix);
    lowestApplied = fix.start;
  }

  return { output, applied: applied.reverse() };
}

/** LSP edits for `fixes`, for a host that would rather apply them itself. */
export function latexFixesToTextEdits(
  text: string,
  fixes: LatexFix[],
): TextEdit[] {
  return fixes
    .filter((fix) => fix.replacement !== undefined)
    .map((fix) => ({
      range: rangeFromOffsets(text, fix.start, fix.end),
      newText: fix.replacement as string,
    }));
}

export interface CleanLatexOptions extends FindFixesOptions {
  /**
   * Cap on find/apply cycles. Rewrites can cascade — `{\bf x}` becomes
   * `\textbf{x}`, which is then flagged as a presentational font macro — and
   * upstream approximated this by running its font pass exactly twice. The loop
   * generalizes that; the cap is a guard against a rule whose output re-matches
   * its own pattern.
   */
  maxPasses?: number;
}

export interface CleanLatexOutcome {
  output: string;
  /**
   * Every fix that was applied, in the order the passes applied them, followed
   * by the `flag` fixes that survive in the final text. Offsets on applied
   * fixes refer to the text as it was when that pass ran, so they are for
   * reporting, not for re-application.
   */
  fixes: LatexFix[];
  /** How many find/apply cycles ran. */
  passes: number;
  /** True if the loop hit `maxPasses` with edits still pending. */
  truncated: boolean;
}

/**
 * Find and apply cleaning fixes until the text stops changing.
 *
 * This is the whole-file path: the import pipeline's `cleanLatex` and the
 * editor's bulk "Clean up" command both come through here. Per-occurrence quick
 * fixes go the other way, through `findLatexFixes` + `applyLatexFixes` with a
 * single fix.
 */
export function cleanLatexText(
  text: string,
  options: CleanLatexOptions = {},
): CleanLatexOutcome {
  const { maxPasses = 5, ...findOptions } = options;
  const fixes: LatexFix[] = [];
  let current = text;
  let passes = 0;
  let truncated = false;

  for (; passes < maxPasses; passes += 1) {
    const found = findLatexFixes(current, findOptions);
    const editable = found.filter((fix) => fix.replacement !== undefined);
    if (editable.length === 0) break;

    const { output, applied } = applyLatexFixes(current, editable);
    if (output === current) break;
    fixes.push(...applied);
    current = output;

    if (passes === maxPasses - 1) {
      truncated = findLatexFixes(current, findOptions).some(
        (fix) => fix.replacement !== undefined,
      );
    }
  }

  // Flags are collected from the settled text so the author is told about what
  // actually survives, not about intermediate states the rewrites passed through.
  fixes.push(
    ...findLatexFixes(current, findOptions).filter(
      (fix) => fix.replacement === undefined,
    ),
  );

  return { output: current, fixes, passes, truncated };
}
