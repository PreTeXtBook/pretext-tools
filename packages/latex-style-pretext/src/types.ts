import type { CompletionItem, Diagnostic } from "vscode-languageserver-types";

/**
 * How an environment's body is shaped when converted to PreTeXt. Drives
 * completion sorting/icons and which snippet skeleton is generated.
 */
export type EnvironmentKind =
  | "block" // theorem-like: <statement> + optional siblings
  | "structural" // divisions and containers (figure, exercises, sidebyside, ...)
  | "list" // enumerate / itemize
  | "display" // math display environments (align, equation, ...)
  | "verbatim"; // code / program / console / sage — raw content, no markup inside

export interface EnvironmentSpec {
  /** Environment name as typed in LaTeX; usually the canonical PreTeXt element. */
  name: string;
  /** Accepted shorthand names, e.g. theorem: ["thm", "theo", "thrm", ...]. */
  aliases: string[];
  /**
   * Converter wraps the body in `<statement>` and hoists proof/hint/answer/
   * solution to siblings of it. Determines the generated snippet skeleton.
   */
  requiresStatement: boolean;
  /** Whether the environment accepts an optional `[title]` argument. */
  titleArg: boolean;
  kind: EnvironmentKind;
  /**
   * Environments meaningful directly inside this one (e.g. `proof` inside a
   * theorem; `hint`/`answer`/`solution` inside an exercise). Used by the
   * completion engine to offer nested structure.
   */
  childEnvironments?: string[];
  /**
   * Override the auto-generated snippet body. Uses LSP snippet syntax
   * (`${1:...}` tab stops). The generator supplies `\begin`/`\end` framing,
   * so this is the inner body only unless it starts with `\begin`.
   */
  snippet?: string;
  documentation?: string;
}

/** Which math contexts a macro is valid in. */
export type MacroMode = "text" | "math" | "both";

export interface MacroSpec {
  /** Macro name without the leading backslash. */
  name: string;
  /**
   * unified-latex style argument signature: space-separated tokens where
   * `m` is a mandatory `{}` argument and `o` an optional `[]` argument.
   * Empty string means the macro takes no arguments.
   */
  signature: string;
  mode: MacroMode;
  snippet?: string;
  documentation?: string;
}

/**
 * The host-facing contract. `pretext-latex` implements it now; a future
 * `pretext-markdown` implementation can plug into the same VS Code / Monaco
 * adapters without changes.
 */
export interface PretextFlavorLanguage {
  languageId: string;
  getCompletions(params: GetCompletionsParams): CompletionItem[];
  getDiagnostics(text: string): Promise<Diagnostic[]>;
}

export interface GetCompletionsParams {
  /** Full document text. */
  text: string;
  /** Zero-based character offset of the cursor within `text`. */
  offset: number;
  /** The character that triggered completion, if any (`\`, `{`, `[`). */
  triggerCharacter?: string;
}
