import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Integration coverage for the PreTeXt "authoring flavor" languages
 * (pretext-latex, pretext-markdown): file identity from the manifest's
 * filenamePatterns, and completions + diagnostics flowing through the LSP.
 */

function fixtureUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "A workspace folder should be open");
  return vscode.Uri.file(path.join(folder!.uri.fsPath, ...segments));
}

/** Poll until `uri` has at least one diagnostic matching `predicate`. */
async function waitForDiagnostic(
  uri: vscode.Uri,
  predicate: (d: vscode.Diagnostic) => boolean,
  timeoutMs = 20000,
): Promise<vscode.Diagnostic> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const match = vscode.languages.getDiagnostics(uri).find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(
    `Timed out waiting for diagnostics on ${uri.fsPath}; got: ` +
      JSON.stringify(
        vscode.languages.getDiagnostics(uri).map((d) => d.message),
      ),
  );
}

/** Poll until an open document at `uri` reports `languageId` (or time out). */
async function waitForLanguageId(
  uri: vscode.Uri,
  languageId: string,
  timeoutMs = 10000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.fsPath === uri.fsPath,
    );
    if (doc?.languageId === languageId) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const doc = vscode.workspace.textDocuments.find(
    (d) => d.uri.fsPath === uri.fsPath,
  );
  assert.fail(
    `Timed out waiting for ${uri.fsPath} to become '${languageId}'; ` +
      `got '${doc?.languageId ?? "(closed)"}'`,
  );
}

async function getCompletionLabels(
  uri: vscode.Uri,
  position: vscode.Position,
  triggerCharacter?: string,
): Promise<string[]> {
  const list = (await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    uri,
    position,
    triggerCharacter,
  )) as vscode.CompletionList;
  return list.items.map((item) =>
    typeof item.label === "string" ? item.label : item.label.label,
  );
}

suite("Flavor languages", () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension("oscarlevin.pretext-tools");
    assert.ok(ext, "Extension should be installed");
    await ext!.activate();
  });

  test("a .ptx.tex file is recognized as pretext-latex", async () => {
    const doc = await vscode.workspace.openTextDocument(
      fixtureUri("source", "sample.ptx.tex"),
    );
    assert.strictEqual(doc.languageId, "pretext-latex");
  });

  test("a .ptx.md file is recognized as pretext-markdown", async () => {
    const doc = await vscode.workspace.openTextDocument(
      fixtureUri("source", "sample.ptx.md"),
    );
    assert.strictEqual(doc.languageId, "pretext-markdown");
  });

  test("pretext-latex gets environment completions through the LSP", async () => {
    const uri = fixtureUri("source", "sample.ptx.tex");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    // Position right after `\begin{` on the first line.
    const labels = await getCompletionLabels(
      uri,
      new vscode.Position(0, "\\begin{".length),
      "{",
    );
    assert.ok(
      labels.includes("theorem"),
      `Expected 'theorem' among completions, got: ${labels.slice(0, 20)}`,
    );
  });

  test("pretext-latex flags an unknown environment", async () => {
    const uri = fixtureUri("source", "sample.ptx.tex");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const diagnostic = await waitForDiagnostic(uri, (d) =>
      d.message.includes("bogusenv"),
    );
    assert.strictEqual(
      diagnostic.severity,
      vscode.DiagnosticSeverity.Warning,
      "Unknown environment should be a warning",
    );
  });

  test("pretext-markdown gets directive completions through the LSP", async () => {
    const uri = fixtureUri("source", "sample.ptx.md");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    // Position right after `:::` on the first line.
    const labels = await getCompletionLabels(
      uri,
      new vscode.Position(0, ":::".length),
      ":",
    );
    assert.ok(
      labels.includes("theorem"),
      `Expected 'theorem' among completions, got: ${labels.slice(0, 20)}`,
    );
  });

  test("pretext-markdown flags an unknown directive", async () => {
    const uri = fixtureUri("source", "sample.ptx.md");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostic(uri, (d) => d.message.includes("bogusdirective"));
  });

  suite("opt-in .tex takeover", () => {
    const setting = "latexPretext.treatTexAsPretext";

    teardown(async () => {
      // Reset to default so ordering/other suites are unaffected. Global target
      // writes to the test instance's user-data dir (gitignored), not the repo.
      await vscode.workspace
        .getConfiguration("pretext-tools")
        .update(setting, undefined, vscode.ConfigurationTarget.Global);
    });

    // Distinct files per case: the takeover listener runs on onDidOpen, which
    // fires only the first time a document is opened. `plain.tex` is opened
    // with the setting off; `plain-on.tex` is opened for the first time with
    // the setting on.
    test("plain .tex stays 'latex' while the setting is off", async () => {
      const doc = await vscode.workspace.openTextDocument(
        fixtureUri("source", "plain.tex"),
      );
      assert.strictEqual(doc.languageId, "latex");
    });

    test("plain .tex is taken over when the setting is enabled", async () => {
      await vscode.workspace
        .getConfiguration("pretext-tools")
        .update(setting, true, vscode.ConfigurationTarget.Global);
      // The fixture root contains project.ptx, so opening a fresh plain .tex
      // triggers the listener; poll for the language switch.
      await vscode.workspace.openTextDocument(
        fixtureUri("source", "plain-on.tex"),
      );
      await waitForLanguageId(
        fixtureUri("source", "plain-on.tex"),
        "pretext-latex",
      );
    });
  });
});
