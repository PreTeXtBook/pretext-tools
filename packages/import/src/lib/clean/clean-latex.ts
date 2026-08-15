// The import pipeline's entry point into LaTeX cleaning.
//
// The rules themselves live in `@pretextbook/latex-style-pretext`'s `clean/`
// module, so the editor (pretext-plus's Monaco, the VS Code LSP server) and this
// importer clean by exactly the same table. What stays here is import-specific:
// `trimJunk` normalization, and the projection of positioned fixes onto the
// aggregate `CleaningWarning` shape the wizard and the VS Code output channel
// already render.

import {
  cleanLatexText,
  type CleanScope,
  type LatexFix,
} from "@pretextbook/latex-style-pretext";
import { trimJunk } from "./latex-utils";
import type { CleaningWarning } from "./warnings";

export interface CleanLatexOptions {
  /**
   * What the text is. Defaults to `"auto"`, which detects `\begin{document}`.
   * Per-division cleaning (SPEC §3.8) passes `"body"`.
   */
  scope?: CleanScope;
  /** Rule ids to skip. */
  disable?: string[];
}

export interface CleanLatexResult {
  output: string;
  /** Aggregate, one row per rule — what the wizard's summary list renders. */
  warnings: CleaningWarning[];
  /**
   * Positioned fixes, in application order. The before/after diff and any
   * per-file report read these; `warnings` is the rolled-up view of the same
   * data.
   */
  fixes: LatexFix[];
}

/**
 * Clean a piece of LaTeX: strip comments and trailing junk, then apply every
 * cleaning rule to a fixpoint.
 *
 * `trimJunk` runs first and stays on this side of the boundary deliberately.
 * Deleting every comment is right for an import (they are authoring notes about
 * LaTeX, not content) but wrong for an editor, where the author is looking at
 * their own comments and would not expect a cleanup to eat them.
 */
export function cleanLatex(
  source: string,
  options: CleanLatexOptions = {},
): CleanLatexResult {
  const text = trimJunk(source).replace(/(\n *){3,}/g, "\n\n");
  const { output, fixes } = cleanLatexText(text, {
    scope: options.scope ?? "auto",
    disable: options.disable,
  });

  return {
    output: output.replace(/(\n *){3,}/g, "\n\n"),
    warnings: fixesToWarnings(fixes),
    fixes,
  };
}

/**
 * Roll positioned fixes up into one `CleaningWarning` per rule.
 *
 * A rule with `reportMatch` emits two rows, matching what the cleaner has always
 * produced: a `save` carrying the matched text (so the author can reconstruct
 * what a `\def` meant) and a `delete` recording that it went away.
 */
export function fixesToWarnings(fixes: LatexFix[]): CleaningWarning[] {
  const byRule = new Map<string, LatexFix[]>();
  for (const fix of fixes) {
    const group = byRule.get(fix.ruleId);
    if (group) group.push(fix);
    else byRule.set(fix.ruleId, [fix]);
  }

  const warnings: CleaningWarning[] = [];
  for (const group of byRule.values()) {
    const [first] = group;
    const base = {
      severity: first.severity,
      kind: first.kind,
      category: first.category,
      macro: first.macro,
      occurrences: group.length,
      message: first.message,
    };

    if (first.reportMatch) {
      warnings.push({
        ...base,
        action: "save",
        examples: group.slice(0, 5).map((fix) => fix.matched),
      });
    }

    if (first.action === "flag") {
      warnings.push({
        ...base,
        action: "anomaly",
        examples: group.slice(0, 5).map((fix) => fix.matched),
      });
    } else if (first.action === "delete") {
      warnings.push({ ...base, action: "delete", severity: "info" });
    } else {
      // `tex_fonts` is the old `fixPlainTeX` group, reported as a plain
      // substitution; every other rewrite is reported as one.
      warnings.push({
        ...base,
        action: first.category === "tex_fonts" ? "replace" : "rewrite",
        replacement: first.replacementLabel ?? first.replacement,
      });
    }
  }

  return warnings;
}
