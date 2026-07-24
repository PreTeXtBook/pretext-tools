import type { CompletionItem, Diagnostic } from "vscode-languageserver-types";
import type { GetCompletionsParams, PretextFlavorLanguage } from "./types";
import { getMarkdownCompletions } from "./completions/get-completions";
import { getMarkdownDiagnostics } from "./lint/get-diagnostics";

/** Language id used by VS Code and Monaco for Markdown-style PreTeXt. */
export const PRETEXT_MARKDOWN_LANGUAGE_ID = "pretext-markdown";

/**
 * The concrete `PretextFlavorLanguage` for Markdown-style PreTeXt. It implements
 * the *same* interface as `pretextLatexLanguage`, so both hosts (the VS Code LSP
 * server and the Monaco editor in pretext-plus-editor) register it alongside the
 * LaTeX flavor without any adapter changes.
 *
 * `getDiagnostics` is async to match the interface (a future AST-based linter
 * may load the parser lazily); the current scanner-based implementation is
 * synchronous and resolves immediately.
 */
export const pretextMarkdownLanguage: PretextFlavorLanguage = {
  languageId: PRETEXT_MARKDOWN_LANGUAGE_ID,
  getCompletions(params: GetCompletionsParams): CompletionItem[] {
    return getMarkdownCompletions(params);
  },
  async getDiagnostics(text: string): Promise<Diagnostic[]> {
    return getMarkdownDiagnostics(text);
  },
};
