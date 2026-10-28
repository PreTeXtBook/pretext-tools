/**
 * The live preview on the desktop host, through the hooks the extension's
 * `activate` returns: the render runs in a forked Node process with
 * WebAssembly JSPI (preview-host-node.ts). A machine with no such runtime
 * (an old VS Code and no Node 24 on the PATH) cannot run it; the test then
 * reports that rather than failing, since the message is the behaviour.
 */
import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

const EXTENSION_ID = "oscarlevin.pretext-tools";

type Outcome =
  | { ok: true; html: string; elapsedMs: number }
  | { ok: false; error: string };

interface PreviewHooks {
  preview: { nextRender(): Promise<Outcome> };
}

async function hooks(): Promise<PreviewHooks> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext, `Extension ${EXTENSION_ID} should be installed`);
  return (await ext!.activate()) as PreviewHooks;
}

suite("Live preview", () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("renders the open source file through the worker process", async function () {
    this.timeout(120000);
    const { preview } = await hooks();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "A workspace folder should be open");
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(
        path.join(folder!.uri.fsPath, "source", "with-includes.ptx"),
      ),
    );
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    const rendered = preview.nextRender();
    await vscode.commands.executeCommand("pretext-tools.instantPreview");
    const outcome = await rendered;
    if (!outcome.ok && /WebAssembly JSPI/.test(outcome.error)) {
      console.log(`Live preview skipped: ${outcome.error}`);
      this.skip();
    }
    assert.ok(
      outcome.ok,
      `the render should succeed, got: ${outcome.ok ? "" : outcome.error}`,
    );
    const html = (outcome as { html: string }).html;
    assert.ok(
      html.includes("A Book With Includes"),
      "the book title is on the page",
    );
    assert.ok(
      html.includes("An Included Chapter"),
      "the xi:included chapter was rendered into the book",
    );
  });
});
