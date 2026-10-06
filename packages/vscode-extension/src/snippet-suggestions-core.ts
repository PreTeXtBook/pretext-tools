/**
 * The `vscode`-free half of the "PreTeXt › Snippet Suggestions" setting: which
 * writes bring `editor.snippetSuggestions` for PreTeXt files in line with it.
 */

/** The settings scopes kept in step (ours is window-scoped: no folder values). */
export const SCOPES = ["global", "workspace"] as const;

export type Scope = (typeof SCOPES)[number];

/** A setting's value in each scope, `undefined` where it isn't set there. */
export type ScopedValues = Partial<Record<Scope, string>>;

export interface SnippetSuggestionsUpdate {
  scope: Scope;
  /** The value to give `[pretext]` `editor.snippetSuggestions`; `undefined` removes it. */
  value: string | undefined;
}

/**
 * The writes to `[pretext]` `editor.snippetSuggestions` (`override`) that copy
 * `pretext-tools.snippetSuggestions` into it, in each scope where ours went
 * from `before` to `after`. A scope where ours didn't change is left alone, so
 * a value set directly for PreTeXt files stays until ours is changed in that
 * scope.
 */
export function snippetSuggestionsUpdates(
  before: ScopedValues,
  after: ScopedValues,
  override: ScopedValues,
): SnippetSuggestionsUpdate[] {
  return SCOPES.filter(
    (scope) =>
      after[scope] !== before[scope] && after[scope] !== override[scope],
  ).map((scope) => ({ scope, value: after[scope] }));
}
