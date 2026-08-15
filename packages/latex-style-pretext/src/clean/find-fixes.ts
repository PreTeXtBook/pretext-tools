// Finds every cleaning opportunity in a piece of LaTeX and reports it as a
// positioned `LatexFix`. Nothing is mutated here — `apply-fixes.ts` does that,
// and `to-diagnostics.ts` turns the same fixes into editor squiggles. One
// engine, three consumers.

import {
  scanDocument,
  VERBATIM_ENVIRONMENTS,
  type Region,
} from "../scan/scan-document";
import {
  CLEAN_RULES,
  type CleanAction,
  type CleanRule,
  type CleanRuleKind,
  type CleanSeverity,
  type ProtectedRegionKind,
} from "./rules";

export interface LatexFix {
  /** The `CleanRule.id` that produced this fix. */
  ruleId: string;
  action: CleanAction;
  severity: CleanSeverity;
  kind: CleanRuleKind;
  category: string;
  /** Macro or environment name, for grouping and display. */
  macro: string;
  /** Offset of the first character of the match, into the text scanned. */
  start: number;
  /** Offset just past the match. */
  end: number;
  /** The matched source text — for the diff view and the change report. */
  matched: string;
  /** Replacement text; `""` for a deletion; `undefined` for `flag`. */
  replacement?: string;
  message?: string;
  /** Show `matched` verbatim in the report rather than just counting it. */
  reportMatch?: boolean;
  /** Readable description of the replacement, when the raw text reads badly. */
  replacementLabel?: string;
}

/** Which part of a document the text handed to `findLatexFixes` represents. */
export type CleanScope = "document" | "preamble" | "body" | "auto";

export interface FindFixesOptions {
  /**
   * What `text` is. `"auto"` (the default) looks for `\begin{document}` and
   * treats the text as a whole document if it finds one, a body fragment if
   * not — which is what a pretext-plus division or a selected range is.
   */
  scope?: CleanScope;
  /** Rule ids to skip. */
  disable?: string[];
  /** Restrict to these rule ids. Applied after `disable`. */
  only?: string[];
}

// ---------------------------------------------------------------------------
// Document regions
// ---------------------------------------------------------------------------

export interface DocumentRegions {
  preamble: Region;
  body: Region;
  /**
   * `\begin{thebibliography}` onwards. Cleaning never touches it: entries are
   * hand-formatted data, and upstream split it off for the same reason.
   */
  bibliography: Region | null;
}

/**
 * Locate the preamble/body/bibliography spans, the positioned equivalent of
 * upstream's `separatePieces`. A document with no `\begin{document}` is all
 * body, so a fragment gets body-scoped rules and no preamble ones.
 */
export function findDocumentRegions(
  text: string,
  scope: CleanScope = "auto",
): DocumentRegions {
  const empty = { start: 0, end: 0 };
  if (scope === "preamble") {
    return {
      preamble: { start: 0, end: text.length },
      body: empty,
      bibliography: null,
    };
  }

  const beginDoc = scope === "body" ? -1 : text.indexOf("\\begin{document}");
  const bodyStart = beginDoc === -1 ? 0 : beginDoc + "\\begin{document}".length;
  const preamble = beginDoc === -1 ? empty : { start: 0, end: beginDoc };

  const bibIndex = text.indexOf("\\begin{thebibliography}", bodyStart);
  const bibliography =
    bibIndex === -1 ? null : { start: bibIndex, end: text.length };

  return {
    preamble,
    body: {
      start: bodyStart,
      end: bibliography ? bibliography.start : text.length,
    },
    bibliography,
  };
}

// ---------------------------------------------------------------------------
// Protected regions
// ---------------------------------------------------------------------------

/**
 * Spans a rule may decline to fire inside, keyed by kind. Upstream matched with
 * bare regexes over the whole document, so `{\bf x}` inside `\begin{verbatim}`
 * was rewritten and `\vspace` in a code listing was deleted. Routing matches
 * through the scanner fixes that class of bug.
 */
function protectedRegions(text: string): Record<ProtectedRegionKind, Region[]> {
  const scan = scanDocument(text);
  const verbatim: Region[] = [];
  let open: number | null = null;
  for (const occ of scan.environments) {
    if (!VERBATIM_ENVIRONMENTS.has(occ.name)) continue;
    if (occ.type === "begin") {
      if (open === null) open = occ.start;
    } else if (open !== null) {
      verbatim.push({ start: open, end: occ.end });
      open = null;
    }
  }
  // An unterminated verbatim body protects the rest of the text.
  if (open !== null) verbatim.push({ start: open, end: text.length });

  return { math: scan.mathRegions, comment: scan.commentRegions, verbatim };
}

const DEFAULT_SKIP: ProtectedRegionKind[] = ["comment", "verbatim"];

function overlapsAny(regions: Region[], start: number, end: number): boolean {
  return regions.some((r) => start < r.end && end > r.start);
}

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

function escapeRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the global pattern a rule scans with. */
export function patternForRule(rule: CleanRule): RegExp {
  const { match } = rule;
  if (match.type === "regex") {
    return new RegExp(
      match.pattern.source,
      match.pattern.flags.includes("g")
        ? match.pattern.flags
        : match.pattern.flags + "g",
    );
  }
  if (match.type === "environment") {
    return new RegExp(
      `\\\\(?:begin|end)\\{\\s*${escapeRegex(match.name)}\\}`,
      "g",
    );
  }
  const name = escapeRegex(match.name);
  if (match.form === "args") {
    let pattern = `\\\\${name}\\b\\*?`;
    for (let i = 0; i < (match.arity ?? 1); i += 1) pattern += "\\{[^{}]*\\}";
    return new RegExp(pattern, "g");
  }
  if (match.form === "line") {
    return new RegExp(`\\\\${name}\\b.*`, "g");
  }
  return new RegExp(`\\\\${name}\\b`, "g");
}

function macroNameForRule(rule: CleanRule): string {
  if (rule.label) return rule.label;
  const { match } = rule;
  if (match.type === "macro" || match.type === "environment") return match.name;
  return rule.id;
}

/** Expand `$1`-style backreferences in a rule's replacement. */
function expandReplacement(
  replacement: string,
  groups: RegExpExecArray,
): string {
  return replacement.replace(
    /\$(\d)/g,
    (_, digit: string) => groups[Number(digit)] ?? "",
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Every cleaning opportunity in `text`, resolved so no two editing fixes
 * overlap and nothing is reported inside a span that another fix deletes.
 *
 * Fixes come back in source order. A `flag` fix has no `replacement` — it is a
 * report only, because only the author knows what a presentational font macro
 * was standing in for.
 */
export function findLatexFixes(
  text: string,
  options: FindFixesOptions = {},
): LatexFix[] {
  const { scope = "auto", disable, only } = options;
  const regions = findDocumentRegions(text, scope);
  const protectedBy = protectedRegions(text);

  const disabled = new Set(disable ?? []);
  const allowed = only ? new Set(only) : null;

  const candidates: Array<LatexFix & { priority: number }> = [];

  CLEAN_RULES.forEach((rule, priority) => {
    if (disabled.has(rule.id)) return;
    if (allowed && !allowed.has(rule.id)) return;

    const skip = rule.skipIn ?? DEFAULT_SKIP;
    const skipRegions = skip.flatMap((kind) => protectedBy[kind]);
    const pattern = patternForRule(rule);

    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // A zero-width match would loop forever.
      if (m[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      if (!inScope(rule.scope, regions, start)) continue;
      if (overlapsAny(skipRegions, start, end)) continue;

      const replacement =
        rule.action === "flag"
          ? undefined
          : rule.action === "delete"
            ? ""
            : expandReplacement(rule.replacement ?? "", m);

      // A rewrite that changes nothing is not a fix; reporting it would also
      // stall the fixpoint loop in `applyAllLatexFixes`.
      if (replacement === m[0]) continue;

      candidates.push({
        ruleId: rule.id,
        action: rule.action,
        severity: rule.severity,
        kind: rule.kind,
        category: rule.category,
        macro: macroNameForRule(rule),
        start,
        end,
        matched: m[0],
        replacement,
        message: rule.message,
        reportMatch: rule.reportMatch,
        replacementLabel: rule.replacementLabel,
        priority,
      });
    }
  });

  return resolveOverlaps(candidates);
}

function inScope(
  scope: CleanRule["scope"],
  regions: DocumentRegions,
  offset: number,
): boolean {
  // The bibliography is off-limits to every rule.
  if (regions.bibliography && offset >= regions.bibliography.start)
    return false;
  if (scope === "anywhere") return true;
  const region = scope === "preamble" ? regions.preamble : regions.body;
  return offset >= region.start && offset < region.end;
}

/**
 * Reduce candidates to a consistent set.
 *
 * Editing fixes are accepted greedily by (start, longest, rule order) — longest
 * first is what makes a whole-line deletion win over a bare macro inside that
 * line, which is the net effect upstream got from deleting both. Anything left
 * that falls inside an accepted edit is dropped, so the author is not told
 * about a macro in text that is going away anyway.
 */
function resolveOverlaps(
  candidates: Array<LatexFix & { priority: number }>,
): LatexFix[] {
  const edits = candidates
    .filter((c) => c.replacement !== undefined)
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - b.start - (a.end - a.start) ||
        a.priority - b.priority,
    );

  const accepted: Array<LatexFix & { priority: number }> = [];
  let consumedTo = -1;
  for (const edit of edits) {
    if (edit.start < consumedTo) continue;
    accepted.push(edit);
    consumedTo = edit.end;
  }

  const flags = candidates.filter(
    (c) =>
      c.replacement === undefined &&
      !accepted.some((e) => c.start >= e.start && c.end <= e.end),
  );

  return [...accepted, ...flags]
    .sort((a, b) => a.start - b.start || a.priority - b.priority)
    .map(({ priority: _priority, ...fix }) => fix);
}
