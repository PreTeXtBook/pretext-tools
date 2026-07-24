import type { CompletionItem, Diagnostic } from "vscode-languageserver-types";
import type { GetCompletionsParams, PretextFlavorLanguage } from "./types";
import { getLatexCompletions } from "./completions/get-completions";
import { getLatexDiagnostics } from "./lint/get-diagnostics";

/** Language id used by VS Code and Monaco for LaTeX-style PreTeXt. */
export const PRETEXT_LATEX_LANGUAGE_ID = "pretext-latex";

/**
 * The concrete `PretextFlavorLanguage` for LaTeX-style PreTeXt. Both hosts (the
 * VS Code LSP server and the Monaco editor in pretext-plus-editor) program
 * against this object, so a future `pretext-markdown` implementation can slot
 * in without touching either adapter.
 *
 * `getDiagnostics` is async to match the interface (a future AST-based linter
 * may load the parser lazily); the current scanner-based implementation is
 * synchronous and resolves immediately.
 */
export const pretextLatexLanguage: PretextFlavorLanguage = {
  languageId: PRETEXT_LATEX_LANGUAGE_ID,
  getCompletions(params: GetCompletionsParams): CompletionItem[] {
    return getLatexCompletions(params);
  },
  async getDiagnostics(text: string): Promise<Diagnostic[]> {
    return getLatexDiagnostics(text);
  },
};
