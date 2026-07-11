import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

const EXTENSION_ID = "oscarlevin.pretext-tools";

suite("Activation", () => {
  test("the extension is present and activates", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} should be installed`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true, "Extension should be active");
  });

  test("a .ptx file is recognized as the 'pretext' language", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "A workspace folder should be open");
    const mainPtx = vscode.Uri.file(
      path.join(folder!.uri.fsPath, "source", "main.ptx"),
    );
    const doc = await vscode.workspace.openTextDocument(mainPtx);
    assert.strictEqual(doc.languageId, "pretext");
  });
});
