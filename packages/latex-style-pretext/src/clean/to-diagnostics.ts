// Projects cleaning fixes onto the LSP surface: squiggles, per-occurrence quick
// fixes, and one "clean up the whole file" source action. Both hosts (the VS
// Code LSP server and Monaco in pretext-plus) consume these directly.

import {
  CodeAction,
  CodeActionKind,
  Diagnostic,
  DiagnosticSeverity,
  type Range,
  type TextEdit,
} from "vscode-languageserver-types";
import { offsetToPosition, rangeFromOffsets } from "../util/position";
import { cleanLatexText, type CleanLatexOptions } from "./apply-fixes";
import {
  findLatexFixes,
  type FindFixesOptions,
  type LatexFix,
} from "./find-fixes";
import { KIND_DESCRIPTIONS, type MacroAlternative } from "./rules";

/**
 * Diagnostic source for cleaning findings. Deliberately distinct from `lint/`'s
 * `"pretext-latex"`: lint answers "will this convert?", cleaning answers
 * "should this still be here?". Hosts can surface or mute them independently.
 */
export const CLEAN_SOURCE = "pretext-latex-clean";

const SEVERITY: Record<LatexFix["severity"], DiagnosticSeverity> = {
  info: DiagnosticSeverity.Information,
  warning: DiagnosticSeverity.Warning,
  error: DiagnosticSeverity.Error,
};

/** The sentence shown to the author for a fix. */
export function describeFix(fix: LatexFix): string {
  if (fix.message) return fix.message;
  const gloss = KIND_DESCRIPTIONS[fix.kind];
  const subject = fix.ruleId.startsWith("env-")
    ? `The ${fix.macro} environment`
    : `\\${fix.macro}`;
  if (fix.action === "replace") {
    return `${subject} is rewritten on import.`;
  }
  if (fix.action === "delete") {
    return gloss
      ? `${subject}: ${gloss}.`
      : `${subject} does not convert to PreTeXt.`;
  }
  if (fix.alternatives?.length) {
    const list = fix.alternatives
      .map((alt) => `\\${alt.macro} (${alt.meaning})`)
      .join(", ");
    return `${subject} marks appearance, not meaning. Consider ${list} instead.`;
  }
  return gloss ? `${subject}: ${gloss}.` : `${subject} is presentational.`;
}

/** One diagnostic per fix, carrying enough `data` to rebuild its edit. */
export function latexFixesToDiagnostics(
  text: string,
  fixes: LatexFix[],
): Diagnostic[] {
  return fixes.map((fix) => ({
    severity: SEVERITY[fix.severity],
    range: rangeFromOffsets(text, fix.start, fix.end),
    source: CLEAN_SOURCE,
    code: fix.ruleId,
    message: describeFix(fix),
    data: {
      ruleId: fix.ruleId,
      start: fix.start,
      end: fix.end,
      replacement: fix.replacement,
    },
  }));
}

/** Scan and diagnose in one call — the usual host entry point. */
export function getLatexCleanDiagnostics(
  text: string,
  options?: FindFixesOptions,
): Diagnostic[] {
  return latexFixesToDiagnostics(text, findLatexFixes(text, options));
}

function offsetOfPosition(
  text: string,
  line: number,
  character: number,
): number {
  let offset = 0;
  for (let l = 0; l < line; l += 1) {
    const nl = text.indexOf("\n", offset);
    if (nl === -1) return text.length;
    offset = nl + 1;
  }
  return Math.min(offset + character, text.length);
}

/** True when `fix` intersects the requested range (a zero-width range counts). */
function fixTouchesRange(text: string, fix: LatexFix, range: Range): boolean {
  const from = offsetOfPosition(text, range.start.line, range.start.character);
  const to = offsetOfPosition(text, range.end.line, range.end.character);
  if (from === to) return fix.start <= from && from <= fix.end;
  return fix.start < to && fix.end > from;
}

export interface CleanCodeActionOptions extends CleanLatexOptions {
  /** Document URI the edits apply to. */
  uri: string;
  /**
   * Include the whole-file "Clean up LaTeX" action. Defaults to true. Hosts
   * that expose the bulk clean as a command of their own can turn it off.
   */
  includeCleanAll?: boolean;
}

/**
 * Quick fixes for the cleaning findings that intersect `range`, plus a
 * source action that applies every fix in the file.
 *
 * A `flag` fix produces no action on purpose — `\textbf` marks appearance, and
 * only the author knows whether that meant `<em>`, `<term>`, or `<alert>`.
 * Offering to guess would put wrong semantics into the document silently.
 */
export function latexFixesToCodeActions(
  text: string,
  range: Range,
  options: CleanCodeActionOptions,
): CodeAction[] {
  const { uri, includeCleanAll = true, ...cleanOptions } = options;
  const fixes = findLatexFixes(text, cleanOptions);
  const actions: CodeAction[] = [];

  for (const fix of fixes) {
    if (!fixTouchesRange(text, fix, range)) continue;

    if (fix.replacement !== undefined) {
      const edit: TextEdit = {
        range: rangeFromOffsets(text, fix.start, fix.end),
        newText: fix.replacement,
      };
      actions.push({
        title: titleForFix(fix),
        kind: CodeActionKind.QuickFix,
        diagnostics: latexFixesToDiagnostics(text, [fix]),
        edit: { changes: { [uri]: [edit] } },
      });
      continue;
    }

    actions.push(...alternativeActions(text, fixes, fix, uri));
  }

  if (includeCleanAll) {
    const outcome = cleanLatexText(text, cleanOptions);
    if (outcome.output !== text) {
      const applied = outcome.fixes.filter(
        (f) => f.replacement !== undefined,
      ).length;
      actions.push({
        title: `Clean up LaTeX (${applied} change${applied === 1 ? "" : "s"})`,
        kind: CodeActionKind.SourceFixAll,
        // One whole-document edit: the fixpoint loop's intermediate offsets do
        // not map back onto the original text, so per-fix edits would be wrong.
        edit: {
          changes: {
            [uri]: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: offsetToPosition(text, text.length),
                },
                newText: outcome.output,
              },
            ],
          },
        },
      });
    }
  }

  return actions;
}

/**
 * Quick fixes for a flagged macro: one per semantic alternative, and — when the
 * same macro is flagged more than once — a "replace all" twin, the way a spell
 * checker offers both "Change" and "Change All".
 *
 * Nothing here is ever applied automatically. `cleanLatexText` only applies
 * fixes that carry a `replacement`, and an alternative deliberately does not:
 * choosing between `\alert`, `\term` and `\emph` is a decision about meaning,
 * not a defect to repair, so it stays with the author.
 */
function alternativeActions(
  text: string,
  allFixes: LatexFix[],
  fix: LatexFix,
  uri: string,
): CodeAction[] {
  if (!fix.alternatives?.length) return [];

  const diagnostics = latexFixesToDiagnostics(text, [fix]);
  // "All" means every occurrence of the *same* macro. Sweeping up `\textit`
  // alongside `\textbf` would answer a question the author was not asked.
  const siblings = allFixes.filter((other) => other.ruleId === fix.ruleId);

  const actions: CodeAction[] = [];
  for (const alt of fix.alternatives) {
    const newText = `\\${alt.macro}`;
    actions.push({
      title: `Replace \\${fix.macro} with \\${alt.macro} — ${alt.meaning}`,
      kind: CodeActionKind.QuickFix,
      diagnostics,
      edit: {
        changes: {
          [uri]: [
            { range: rangeFromOffsets(text, fix.start, fix.end), newText },
          ],
        },
      },
    });

    if (siblings.length > 1) {
      actions.push({
        title: `Replace all ${siblings.length} \\${fix.macro} with \\${alt.macro}`,
        kind: CodeActionKind.QuickFix,
        diagnostics,
        edit: {
          changes: {
            [uri]: siblings.map((sibling) => ({
              range: rangeFromOffsets(text, sibling.start, sibling.end),
              newText,
            })),
          },
        },
      });
    }
  }

  return actions;
}

function titleForFix(fix: LatexFix): string {
  const subject = fix.ruleId.startsWith("env-")
    ? `\\begin{${fix.macro}}`
    : `\\${fix.macro}`;
  if (fix.replacement === "") return `Remove ${subject}`;
  return `Replace ${subject} with ${fix.replacementLabel ?? fix.replacement?.trim()}`;
}
