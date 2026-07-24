import type { PretextFlavorLanguage } from "@pretextbook/latex-style-pretext";
import { pretextLatexLanguage } from "@pretextbook/latex-style-pretext";
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
