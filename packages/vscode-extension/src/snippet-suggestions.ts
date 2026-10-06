/**
 * "PreTeXt › Snippet Suggestions" (`pretext-tools.snippetSuggestions`): where
 * the contributed snippets appear in the completion list in PreTeXt files.
 *
 * The extension defaults `editor.snippetSuggestions` to "none" for PreTeXt
 * files (`configurationDefaults` in package.json), and that language default
 * outranks the plain "Editor: Snippet Suggestions" setting, so turning the
 * snippets back on otherwise takes finding the PreTeXt-specific value with
 * `@lang:pretext`. This setting puts it with the other PreTeXt settings:
 * changing it writes `[pretext]` `editor.snippetSuggestions` in the same scope
 * (user or workspace settings).
 */
import { ConfigurationTarget, Disposable, window, workspace } from "vscode";
import {
  snippetSuggestionsUpdates,
  type Scope,
  type ScopedValues,
} from "./snippet-suggestions-core";

const SECTION = "pretext-tools";
const SETTING = "snippetSuggestions";

const TARGETS: Record<Scope, ConfigurationTarget> = {
  global: ConfigurationTarget.Global,
  workspace: ConfigurationTarget.Workspace,
};

function ours(): ScopedValues {
  const inspected = workspace
    .getConfiguration(SECTION)
    .inspect<string>(SETTING);
  return {
    global: inspected?.globalValue,
    workspace: inspected?.workspaceValue,
  };
}

const pretextEditorSettings = () =>
  workspace.getConfiguration("editor", { languageId: "pretext" });

function override(): ScopedValues {
  const inspected = pretextEditorSettings().inspect<string>(SETTING);
  return {
    global: inspected?.globalLanguageValue,
    workspace: inspected?.workspaceLanguageValue,
  };
}

/**
 * Keep `[pretext]` `editor.snippetSuggestions` in step with ours. At
 * activation this catches up a value of ours set while the extension wasn't
 * running (or synced from another machine without the language override).
 */
export function registerSnippetSuggestions(): Disposable {
  let before: ScopedValues = {};

  const sync = async () => {
    const after = ours();
    const updates = snippetSuggestionsUpdates(before, after, override());
    before = after;
    for (const { scope, value } of updates) {
      try {
        await pretextEditorSettings().update(
          SETTING,
          value,
          TARGETS[scope],
          true,
        );
      } catch (error) {
        void window.showWarningMessage(
          `Couldn't set "Editor: Snippet Suggestions" for PreTeXt files: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };

  void sync();
  return workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${SECTION}.${SETTING}`)) {
      void sync();
    }
  });
}
