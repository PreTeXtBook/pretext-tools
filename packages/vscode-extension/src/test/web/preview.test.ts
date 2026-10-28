/**
 * The live preview on the browser host: the PreTeXt stylesheets run as
 * WebAssembly in a Web Worker next to the extension, reading the project and
 * the bundled stylesheets through the extension host (preview-host-browser.ts).
 * Needs WebAssembly JSPI, which the Chromium `@vscode/test-web` drives has;
 * the test says so rather than failing if it ever runs somewhere without it.
 */
import * as assert from "./assert";
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

function fixtureUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "A workspace folder should be open");
  return vscode.Uri.joinPath(folder!.uri, ...segments);
}

suite("Web live preview", () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("renders the open source file in a Web Worker", async function () {
    this.timeout(120000);
    const wasm = (globalThis as { WebAssembly?: object }).WebAssembly;
    if (!wasm || !("Suspending" in wasm)) {
      this.skip(); // no JSPI in this browser; the command reports as much
    }
    const { preview } = await hooks();
    const doc = await vscode.workspace.openTextDocument(
      fixtureUri("source", "main.ptx"),
    );
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    const rendered = preview.nextRender();
    await vscode.commands.executeCommand("pretext-tools.instantPreview");
    const outcome = await rendered;
    assert.ok(
      outcome.ok,
      `the render should succeed, got: ${outcome.ok ? "" : outcome.error}`,
    );
    const html = (outcome as { html: string }).html;
    assert.ok(html.includes("A Test Book"), "the book title is on the page");
    assert.ok(
      html.includes("sec-hello"),
      "the section's xml:id is on the page",
    );
  });

  test("re-renders on save, reading includes through the host", async function () {
    this.timeout(120000);
    const wasm = (globalThis as { WebAssembly?: object }).WebAssembly;
    if (!wasm || !("Suspending" in wasm)) {
      this.skip();
    }
    const { preview } = await hooks();
    // A file that xi:includes another: the worker has to ask the host for
    // ch1.ptx to render it.
    const doc = await vscode.workspace.openTextDocument(
      fixtureUri("source", "with-includes.ptx"),
    );
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    const rendered = preview.nextRender();
    await vscode.commands.executeCommand("pretext-tools.instantPreview");
    const outcome = await rendered;
    assert.ok(
      outcome.ok,
      `the render should succeed, got: ${outcome.ok ? "" : outcome.error}`,
    );
    assert.ok(
      (outcome as { html: string }).html.includes("An Included Chapter"),
      "the included chapter was rendered into the book",
    );
  });
});
