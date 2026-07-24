import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver-types";
import { scanDocument } from "../scan/scan-document";
import { isKnownContainerDirective } from "../data/directives";
import { isKnownMathMacro } from "../data/math";
import { rangeFromOffsets } from "../util/position";

const SOURCE = "pretext-markdown";

/**
 * Parse-level validation for Markdown-style PreTeXt. Reports colon fences whose
 * open/close counts don't match (or that are unmatched), container directives
 * the conversion does not support, and math macros KaTeX does not know. Nothing
 * is reported inside fenced code, HTML comments, or frontmatter (the scanner
 * already excludes those regions).
 *
 * Python-style markers (`Name:` with an indented body) close implicitly by
 * dedent and only exist for names the converter supports, so they are never a
 * source of fence-matching or unknown-directive diagnostics.
 *
 * There is no "unknown macro" text-mode check: markdown has no loose `\macro`
 * prose to police, and leaf directives (`::name`) accept any name (they become
 * `<plus:name/>` includes), so they are never flagged.
 */
export function getMarkdownDiagnostics(text: string): Diagnostic[] {
  const scan = scanDocument(text);
  const diagnostics: Diagnostic[] = [];

  // 1 & 2. Fence matching (colon counts must match) and unknown-directive
  // checks. Only colon fences participate; python markers pop implicitly.
  const stack: { name: string; colons: number; start: number; end: number }[] =
    [];
  for (const occ of scan.directives) {
    if (occ.type === "open") {
      stack.push({
        name: occ.name,
        colons: occ.colons,
        start: occ.start,
        end: occ.end,
      });
      if (occ.style === "fence" && !isKnownContainerDirective(occ.name)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: rangeFromOffsets(text, occ.start, occ.end),
          source: SOURCE,
          message: `":::${occ.name}" is not a supported PreTeXt directive and will not convert.`,
        });
      }
    } else if (occ.type === "close") {
      const top = stack[stack.length - 1];
      if (occ.style === "python") {
        stack.pop();
      } else if (top && top.colons === occ.colons) {
        stack.pop();
      } else if (top) {
        // A colon fence only pairs when its count matches the innermost open;
        // the converter drops a mismatched close as literal text, leaving the
        // directive open (directive-normalizer.ts:122).
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: rangeFromOffsets(text, occ.start, occ.end),
          source: SOURCE,
          message: `Closing fence "${":".repeat(occ.colons)}" (${occ.colons} colons) does not match the open ":::${top.name}" (${top.colons} colons); an open and its close must use the same number of colons.`,
        });
      } else {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: rangeFromOffsets(text, occ.start, occ.end),
          source: SOURCE,
          message: `Closing "${":".repeat(occ.colons)}" fence has no matching open directive.`,
        });
      }
    }
  }
  for (const open of stack) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: rangeFromOffsets(text, open.start, open.end),
      source: SOURCE,
      message: `":::${open.name}" is never closed with a "${":".repeat(open.colons)}" fence.`,
    });
  }

  // 3. Unknown math macros inside math regions.
  const macroRe = /\\([a-zA-Z]+)/g;
  for (const region of scan.mathRegions) {
    const body = text.slice(region.start, region.end);
    let m: RegExpExecArray | null;
    while ((m = macroRe.exec(body)) !== null) {
      const name = m[1];
      if (isKnownMathMacro(name)) continue;
      const start = region.start + m.index;
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: rangeFromOffsets(text, start, start + m[0].length),
        source: SOURCE,
        message: `\\${name} is not a KaTeX-supported math macro; it may not render.`,
      });
    }
  }

  return diagnostics;
}
