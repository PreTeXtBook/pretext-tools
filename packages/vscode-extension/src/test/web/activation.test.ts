/**
 * Smoke tests for the browser entry point (`extension.web.ts`): the bundle
 * loads in a Web Worker, activates, and the declarative contributions apply.
 * Deeper behaviour is covered by the unit specs and the desktop integration
 * suite; this run exists to catch a Node import or a Node-only global
 * sneaking into the web bundle.
 */
import * as assert from "./assert";
import * as vscode from "vscode";

const EXTENSION_ID = "oscarlevin.pretext-tools";

suite("Web activation", () => {
  test("the extension is present and activates in the browser host", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} should be installed`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true, "Extension should be active");
  });

  test("a .ptx file is recognized as the 'pretext' language", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "A workspace folder should be open");
    const mainPtx = vscode.Uri.joinPath(folder!.uri, "source", "main.ptx");
    const doc = await vscode.workspace.openTextDocument(mainPtx);
    assert.strictEqual(doc.languageId, "pretext");
  });

  test("web-safe commands are registered; CLI commands are not", async () => {
    const all = new Set(await vscode.commands.getCommands(true));
    for (const cmd of [
      "pretext-tools.format",
      "pretext-tools.convertText",
      "pretext-tools.pasteAndConvert",
      "pretext-tools.showLog",
      "pretext-tools.gettingStarted",
    ]) {
      assert.ok(all.has(cmd), `${cmd} should be registered on the web`);
    }
    for (const cmd of [
      "pretext-tools.buildLast",
      "pretext-tools.instantPreview",
      "pretext-tools.new",
    ]) {
      assert.ok(
        !all.has(cmd),
        `${cmd} needs the CLI and must not register on the web`,
      );
    }
  });

  test("Format Document works without a language server", async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: "pretext",
      content: "<p>Hello   <em>world</em></p>",
    });
    const editor = await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("pretext-tools.format");
    // Line endings follow `files.eol` and the indent follows `editor.tabSize`,
    // both host defaults here; the shape is what proves the formatter ran.
    const lines = editor.document.getText().trim().split(/\r?\n/);
    assert.strictEqual(lines.length, 3, "formatted into three lines");
    assert.strictEqual(lines[0], "<p>");
    assert.strictEqual(lines[1].trim(), "Hello <em>world</em>");
    assert.ok(/^[ \t]+/.test(lines[1]), "paragraph content is indented");
    assert.strictEqual(lines[2], "</p>");
  });
});
