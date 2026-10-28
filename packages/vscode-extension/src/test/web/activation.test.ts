/**
 * Smoke tests for the browser entry point (`extension.web.ts`): the bundle
 * loads in a Web Worker, activates, the declarative contributions apply, and
 * the language server — itself a Web Worker — answers. Deeper behaviour is
 * covered by the unit specs and the desktop integration suite; this run
 * exists to catch a Node import or a Node-only global sneaking into either
 * web bundle.
 */
import * as assert from "./assert";
import * as vscode from "vscode";

const EXTENSION_ID = "oscarlevin.pretext-tools";

/** Poll `probe` until it returns a value or `timeoutMs` elapses. */
async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function fixtureUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "A workspace folder should be open");
  return vscode.Uri.joinPath(folder!.uri, ...segments);
}

suite("Web activation", () => {
  test("the extension is present and activates in the browser host", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} should be installed`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true, "Extension should be active");
  });

  test("a .ptx file is recognized as the 'pretext' language", async () => {
    const doc = await vscode.workspace.openTextDocument(
      fixtureUri("source", "main.ptx"),
    );
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
      "pretext-tools.instantPreview",
    ]) {
      assert.ok(all.has(cmd), `${cmd} should be registered on the web`);
    }
    for (const cmd of [
      "pretext-tools.buildLast",
      "pretext-tools.livePreview",
      "pretext-tools.new",
    ]) {
      assert.ok(
        !all.has(cmd),
        `${cmd} needs the CLI and must not register on the web`,
      );
    }
  });

  test("Format Document goes through the worker language server", async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: "pretext",
      content: "<p>Hello   <em>world</em></p>",
    });
    const editor = await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("pretext-tools.format");
    // The server applies the edit asynchronously (workspace/applyEdit), so
    // wait for it. Line endings follow `files.eol` and the indent follows
    // `editor.tabSize`, both host defaults here; the shape is what proves the
    // formatter ran.
    const lines = await waitFor(
      () => {
        const split = editor.document.getText().trim().split(/\r?\n/);
        return split.length === 3 ? split : undefined;
      },
      15000,
      "the formatted document",
    );
    assert.strictEqual(lines[0], "<p>");
    assert.strictEqual(lines[1].trim(), "Hello <em>world</em>");
    assert.ok(/^[ \t]+/.test(lines[1]), "paragraph content is indented");
    assert.strictEqual(lines[2], "</p>");
  });

  test("the worker language server offers schema completions", async () => {
    const doc = await vscode.workspace.openTextDocument(
      fixtureUri("source", "main.ptx"),
    );
    await vscode.window.showTextDocument(doc);
    // Just inside the <p> element of the fixture: ask what may go here.
    const text = doc.getText();
    const offset = text.indexOf("<p>") + "<p>".length;
    const position = doc.positionAt(offset);
    const items = await waitFor(
      async () => {
        const list =
          await vscode.commands.executeCommand<vscode.CompletionList>(
            "vscode.executeCompletionItemProvider",
            doc.uri,
            position,
            "<",
          );
        return list && list.items.length > 0 ? list.items : undefined;
      },
      30000,
      "completions from the language server",
    );
    const labels = items.map((item) =>
      typeof item.label === "string" ? item.label : item.label.label,
    );
    assert.ok(
      labels.some((label) => /\bm\b|<m>|\bem\b|<em>/.test(label)),
      `expected an inline element among completions, got: ${labels
        .slice(0, 15)
        .join(", ")}`,
    );
  });

  test("the worker language server loads its schema assets", async () => {
    type Status = {
      assetsUri?: string;
      schemaLoaded: boolean;
      grammarLoaded: boolean;
      projectFiles: number;
      loadError?: string;
    };
    let last: Status | undefined;
    const status = await waitFor(
      async () => {
        last = await vscode.commands.executeCommand<Status>(
          "pretext-tools.serverStatus",
        );
        return last &&
          last.grammarLoaded &&
          last.schemaLoaded &&
          last.projectFiles > 0
          ? last
          : undefined;
      },
      60000,
      `the server to load its assets (last status: ${JSON.stringify(last)})`,
    ).catch((error) => {
      throw new Error(`${error.message}; last status ${JSON.stringify(last)}`);
    });
    assert.ok(status.projectFiles > 0, "the client sent a project snapshot");
  });

  test("the worker language server validates against the schema", async () => {
    // Validation keys off the file extension, so edit a real .ptx (in
    // memory — the mount is read-only and nothing is saved) rather than an
    // untitled document.
    const doc = await vscode.workspace.openTextDocument(
      fixtureUri("source", "main.ptx"),
    );
    const editor = await vscode.window.showTextDocument(doc);
    const offset = doc.getText().indexOf("<p>");
    await editor.edit((edit) =>
      edit.insert(doc.positionAt(offset), "<notanelement/>\n"),
    );
    const diagnostics = await waitFor(
      () => {
        const found = vscode.languages
          .getDiagnostics(doc.uri)
          .filter((d) => d.range.start.line === doc.positionAt(offset).line);
        return found.length > 0 ? found : undefined;
      },
      30000,
      "a schema diagnostic about <notanelement>",
    ).catch(async (error) => {
      const status = await vscode.commands.executeCommand(
        "pretext-tools.serverStatus",
      );
      const all = vscode.languages
        .getDiagnostics(doc.uri)
        .map((d) => d.message);
      throw new Error(
        `${error.message}; diagnostics ${JSON.stringify(all)}; status ${JSON.stringify(status)}`,
      );
    });
    assert.ok(
      diagnostics.some((d) => /not allowed/.test(d.message)),
      `expected a 'not allowed' diagnostic on the inserted line, got: ${diagnostics
        .map((d) => d.message)
        .join(" | ")}`,
    );
    // Put the fixture back so later suites see it as it is on disk.
    await vscode.commands.executeCommand("undo");
  });
});
