/**
 * The `vscode`-free half of paste-and-convert (SPEC §9.5) that stays here.
 *
 * Detection (`detectSnippetFormat`) and placement (`isInlineContext`,
 * `placeConvertedMarkup`, `reindentForContext`) both live in
 * `@pretextbook/import`, so this extension and pretext-plus follow one set of
 * rules rather than two copies that drift. What remains is the log line, which
 * is only meaningful to a host that has an output channel to write it to.
 */
import { detectSnippetFormat, scoreSnippetFormats } from "@pretextbook/import";

/** Why a snippet was or was not offered for conversion — for the log. */
export function describeDetection(text: string): string {
  const { latex, markdown } = scoreSnippetFormats(text.trim());
  const verdict = detectSnippetFormat(text) ?? "none";
  return `latex=${latex} markdown=${markdown} -> ${verdict}`;
}
