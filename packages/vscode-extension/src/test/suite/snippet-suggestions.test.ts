import * as assert from "assert";
import * as vscode from "vscode";

/**
 * "PreTeXt › Snippet Suggestions" is copied into `editor.snippetSuggestions`
 * for PreTeXt files, in the same scope.
 */

const EXTENSION_ID = "oscarlevin.pretext-tools";

const pretextSnippetSuggestions = () =>
  vscode.workspace
    .getConfiguration("editor", { languageId: "pretext" })
    .inspect<string>("snippetSuggestions");

/** Poll until `[pretext]` editor.snippetSuggestions in user settings is `expected`. */
async function waitForUserValue(
  expected: string | undefined,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pretextSnippetSuggestions()?.globalLanguageValue === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.strictEqual(
    pretextSnippetSuggestions()?.globalLanguageValue,
    expected,
  );
}

suite("Snippet suggestions setting", () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
  });

  teardown(async () => {
    // Global target writes to the test instance's user-data dir, not the repo.
    await vscode.workspace
      .getConfiguration("pretext-tools")
      .update(
        "snippetSuggestions",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    await vscode.workspace
      .getConfiguration("editor", { languageId: "pretext" })
      .update(
        "snippetSuggestions",
        undefined,
        vscode.ConfigurationTarget.Global,
        true,
      );
  });

  test("snippets are left out of the completion list by default", () => {
    assert.strictEqual(
      pretextSnippetSuggestions()?.defaultLanguageValue,
      "none",
    );
  });

  test("setting it sets editor.snippetSuggestions for PreTeXt files", async () => {
    await vscode.workspace
      .getConfiguration("pretext-tools")
      .update(
        "snippetSuggestions",
        "bottom",
        vscode.ConfigurationTarget.Global,
      );
    await waitForUserValue("bottom");
    assert.strictEqual(
      vscode.workspace
        .getConfiguration("editor", { languageId: "pretext" })
        .get("snippetSuggestions"),
      "bottom",
    );

    await vscode.workspace
      .getConfiguration("pretext-tools")
      .update(
        "snippetSuggestions",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    await waitForUserValue(undefined);
    assert.strictEqual(
      vscode.workspace
        .getConfiguration("editor", { languageId: "pretext" })
        .get("snippetSuggestions"),
      "none",
    );
  });
});
