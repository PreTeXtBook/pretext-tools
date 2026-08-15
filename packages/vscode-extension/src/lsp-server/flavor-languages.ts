import type {
  LatexFix,
  PretextFlavorLanguage,
} from "@pretextbook/latex-style-pretext";
import {
  latexFixesToDiagnostics,
  pretextLatexLanguage,
} from "@pretextbook/latex-style-pretext";
import type { Diagnostic } from "vscode-languageserver-types";
import { pretextMarkdownLanguage } from "@pretextbook/markdown-style-pretext";

/**
 * The PreTeXt "authoring flavor" languages the LSP server can route to, keyed
 * by VS Code language id. Each implements the shared `PretextFlavorLanguage`
 * interface, so adding a flavor is one more entry here (plus the language
 * contribution in package.json) — no handler rework.
 */
const FLAVOR_LANGUAGES: ReadonlyMap<string, PretextFlavorLanguage> = new Map(
  [pretextLatexLanguage, pretextMarkdownLanguage].map((lang) => [
    lang.languageId,
    lang,
  ]),
);

/** The flavor language for a document's languageId, if it is one. */
export function getFlavorLanguage(
  languageId: string,
): PretextFlavorLanguage | undefined {
  return FLAVOR_LANGUAGES.get(languageId);
}

/**
 * Completion trigger characters needed only by the flavor languages. LSP
 * trigger registration is global, so these fire in ordinary `pretext`
 * documents too — the completion handler swallows those requests instead of
 * routing them to the schema engine.
 */
export const FLAVOR_ONLY_TRIGGER_CHARACTERS = ["\\", "{", "[", ":", "#"];

/**
 * How to scope cleanup rules for a flavor document. `"auto"` is right for both
 * shapes a flavor file takes: a standalone `.tex` with a `\begin{document}`
 * gets preamble and body rules in their own regions, while a `.ptx.tex`
 * fragment has no preamble and is treated as all body — so preamble-only rules
 * stay quiet instead of firing on prose.
 */
export function cleanScopeFor(_languageId: string): {
  scope: "document" | "preamble" | "body" | "auto";
} {
  return { scope: "auto" };
}

/**
 * Cleanup findings for a flavor document, as diagnostics. Returns nothing for a
 * flavor that has no legacy dialect behind it (markdown-style PreTeXt today).
 */
export function flavorCleanDiagnostics(
  flavor: PretextFlavorLanguage,
  text: string,
  languageId: string,
): Diagnostic[] {
  if (!flavor.getCleanFixes) {
    return [];
  }
  const fixes = flavor.getCleanFixes(text, cleanScopeFor(languageId));
  return latexFixesToDiagnostics(text, fixes as LatexFix[]);
}
