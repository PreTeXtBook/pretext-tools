import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Integration coverage for document links served by the LSP: `xi:include`
 * hrefs in source files, and the file references in `project.ptx`.
 */

function fixtureUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "A workspace folder should be open");
  return vscode.Uri.file(path.join(folder!.uri.fsPath, ...segments));
}

/**
 * Ask VS Code for the links in `uri`, retrying until the LSP has parsed the
 * document (link providers return nothing until then).
 */
async function waitForLinks(
  uri: vscode.Uri,
  timeoutMs = 20000,
): Promise<vscode.DocumentLink[]> {
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(uri),
  );
  const start = Date.now();
  let links: vscode.DocumentLink[] = [];
  while (Date.now() - start < timeoutMs) {
    links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
      "vscode.executeLinkProvider",
      uri,
    );
    if (links && links.length > 0) {
      return links;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`Timed out waiting for document links on ${uri.fsPath}`);
}

suite("Document links", () => {
  test("an xi:include href links to the included file", async () => {
    const uri = fixtureUri("source", "with-includes.ptx");
    const links = await waitForLinks(uri);
    const targets = links.map((link) => link.target?.fsPath);
    assert.ok(
      targets.includes(fixtureUri("source", "ch1.ptx").fsPath),
      `Expected a link to ch1.ptx; got ${JSON.stringify(targets)}`,
    );
  });

  test("the link covers the href value, not the whole element", async () => {
    const uri = fixtureUri("source", "with-includes.ptx");
    const doc = await vscode.workspace.openTextDocument(uri);
    const links = await waitForLinks(uri);
    const include = links.find(
      (link) => link.target?.fsPath === fixtureUri("source", "ch1.ptx").fsPath,
    );
    assert.ok(include, "Expected a link for the xi:include");
    assert.strictEqual(doc.getText(include!.range), "ch1.ptx");
  });

  test("project.ptx file references are linked", async () => {
    const links = await waitForLinks(fixtureUri("project.ptx"));
    assert.ok(links.length > 0, "Expected links in project.ptx");
  });
});
