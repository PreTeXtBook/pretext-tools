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
import {
  readMacroCall,
  removalsAreEquivalent,
  unwrapMacroText,
  type MacroCall,
} from "./macro-call";

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

    actions.push(...flaggedMacroActions(text, fixes, fix, uri));
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
 * Quick fixes for a flagged macro, in increasing order of destructiveness:
 * swap it for a semantic macro, drop the markup but keep the words, or delete
 * the whole thing. Each gets an "all occurrences" twin once the macro appears
 * more than once, the way a spell checker offers both "Change" and "Change All".
 *
 * Nothing here is ever applied automatically. `cleanLatexText` only applies
 * fixes that carry a `replacement`, and a flagged macro deliberately does not:
 * choosing between `\alert`, `\term`, plain text, and nothing at all is a
 * decision about meaning, not a defect to repair, so it stays with the author.
 */
function flaggedMacroActions(
  text: string,
  allFixes: LatexFix[],
  fix: LatexFix,
  uri: string,
): CodeAction[] {
  const diagnostics = latexFixesToDiagnostics(text, [fix]);
  // "All" means every occurrence of the *same* macro. Sweeping up `\textit`
  // alongside `\textbf` would answer a question the author was not asked.
  const siblings = allFixes.filter((other) => other.ruleId === fix.ruleId);
  const actions: CodeAction[] = [];

  /**
   * Build the single-occurrence action and, when there is more than one
   * occurrence, its all-occurrences twin. `edit` maps an occurrence to its own
   * replacement, because removal spans differ per occurrence — one `\textbf`
   * may wrap two words and the next a whole sentence.
   */
  const offer = (
    title: string,
    allTitle: string,
    edit: (
      occurrence: LatexFix,
    ) => { start: number; end: number; newText: string } | null,
  ) => {
    const own = edit(fix);
    if (!own) return;
    actions.push({
      title,
      kind: CodeActionKind.QuickFix,
      diagnostics,
      edit: {
        changes: {
          [uri]: [
            {
              range: rangeFromOffsets(text, own.start, own.end),
              newText: own.newText,
            },
          ],
        },
      },
    });

    if (siblings.length < 2) return;
    const all = siblings.map(edit).filter((e) => e !== null);
    if (all.length < 2) return;
    actions.push({
      title: allTitle.replace("{n}", String(all.length)),
      kind: CodeActionKind.QuickFix,
      diagnostics,
      edit: {
        changes: {
          [uri]: all.map((e) => ({
            range: rangeFromOffsets(text, e.start, e.end),
            newText: e.newText,
          })),
        },
      },
    });
  };

  for (const alt of fix.alternatives ?? []) {
    offer(
      `Replace \\${fix.macro} with \\${alt.macro} — ${alt.meaning}`,
      `Replace all {n} \\${fix.macro} with \\${alt.macro}`,
      (occurrence) => ({
        start: occurrence.start,
        end: occurrence.end,
        newText: `\\${alt.macro}`,
      }),
    );
  }

  const callAt = (occurrence: LatexFix): MacroCall | null =>
    readMacroCall(text, occurrence.start);

  // Keep the words, drop the markup. Not offered for a switch-style use
  // (`{\textbf ...}`), where there is no argument to keep and this would be the
  // same edit as deleting.
  const own = callAt(fix);
  if (own && !removalsAreEquivalent(own)) {
    offer(
      `Remove \\${fix.macro}, keep its text`,
      `Remove all {n} \\${fix.macro}, keep their text`,
      (occurrence) => {
        const call = callAt(occurrence);
        if (!call || removalsAreEquivalent(call)) return null;
        return {
          start: call.start,
          end: call.end,
          newText: unwrapMacroText(text, call),
        };
      },
    );
  }

  offer(
    own && !removalsAreEquivalent(own)
      ? `Delete \\${fix.macro} and its text`
      : `Delete \\${fix.macro}`,
    `Delete all {n} \\${fix.macro} and their text`,
    (occurrence) => {
      const call = callAt(occurrence);
      if (!call) return null;
      return { start: call.start, end: call.end, newText: "" };
    },
  );

  return actions;
}

function titleForFix(fix: LatexFix): string {
  const subject = fix.ruleId.startsWith("env-")
    ? `\\begin{${fix.macro}}`
    : `\\${fix.macro}`;
  if (fix.replacement === "") return `Remove ${subject}`;
  return `Replace ${subject} with ${fix.replacementLabel ?? fix.replacement?.trim()}`;
}
