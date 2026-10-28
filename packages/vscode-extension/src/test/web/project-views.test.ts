/**
 * The Outline and Targets views on the browser host. There is no disk here:
 * project discovery and the project-wide outline read the virtual workspace
 * through `workspace.fs`, and every path they hand around is one of
 * virtual-path.ts's. The trees are read back through the providers the
 * extension's `activate` returns.
 */
import * as assert from "./assert";
import * as vscode from "vscode";

const EXTENSION_ID = "oscarlevin.pretext-tools";

interface OutlineNodeLike {
  tag: string;
  title: string;
  uri: vscode.Uri;
  line: number;
  children: OutlineNodeLike[];
}
interface TargetNodeLike {
  target: { name: string; format?: string };
}
interface Views {
  outline: {
    getChildren(node?: OutlineNodeLike): OutlineNodeLike[];
    setScope(scope: "file" | "project"): void;
    refresh(): void;
  };
  targets: {
    getChildren(): Promise<TargetNodeLike[]>;
    getTreeItem(node: TargetNodeLike): vscode.TreeItem;
  };
}

async function views(): Promise<Views> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext, `Extension ${EXTENSION_ID} should be installed`);
  return (await ext!.activate()) as Views;
}

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

suite("Web project views", () => {
  suiteTeardown(async () => {
    (await views()).outline.setScope("file");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("the Targets view lists the manifest's targets", async () => {
    const { targets } = await views();
    const nodes = await targets.getChildren();
    assert.strictEqual(
      nodes
        .map((n) => n.target.name)
        .sort()
        .join(","),
      "includes,print,web",
    );
    const print = nodes.find((n) => n.target.name === "print")!;
    assert.strictEqual(targets.getTreeItem(print).description, "pdf");
  });

  test("a target row opens its definition in project.ptx", async () => {
    const { targets } = await views();
    const print = (await targets.getChildren()).find(
      (n) => n.target.name === "print",
    );
    assert.ok(print, "the print target is listed");
    await vscode.commands.executeCommand(
      "pretext-tools.revealTargetDefinition",
      print,
    );
    const editor = vscode.window.activeTextEditor;
    assert.ok(
      editor && editor.document.uri.path.endsWith("/project.ptx"),
      "project.ptx is the active editor",
    );
    const line = editor!.document.lineAt(editor!.selection.active.line).text;
    assert.ok(
      line.includes('name="print"'),
      `the selection sits on the print target, got: ${line}`,
    );
  });

  test("the project outline follows xi:includes through workspace.fs", async () => {
    const { outline } = await views();
    outline.setScope("project");
    // Two targets share main.ptx and one uses with-includes.ptx, so the tree
    // groups by source.
    const groups = await waitFor(
      () => {
        const roots = outline.getChildren();
        return roots.length === 2 ? roots : undefined;
      },
      30000,
      "a project outline with one group per target source",
    );
    const group = groups.find((g) => g.title.endsWith("with-includes.ptx"));
    assert.ok(
      group,
      `a group for with-includes.ptx among: ${groups.map((g) => g.title).join(", ")}`,
    );
    const book = group!.children[0];
    assert.strictEqual(book.title, "A Book With Includes");
    const chapter = book.children[0];
    assert.ok(chapter, "the included chapter was spliced into the book");
    assert.strictEqual(chapter.title, "An Included Chapter");
    assert.ok(
      chapter.uri.path.endsWith("/source/ch1.ptx"),
      `the chapter comes from ch1.ptx, got ${chapter.uri.toString()}`,
    );

    await vscode.commands.executeCommand(
      "pretext-tools.outlineJumpToLine",
      chapter,
    );
    const active = await waitFor(
      () => {
        const editor = vscode.window.activeTextEditor;
        return editor && editor.document.uri.path.endsWith("/source/ch1.ptx")
          ? editor
          : undefined;
      },
      10000,
      "ch1.ptx to open from the outline",
    );
    assert.strictEqual(active.selection.active.line, chapter.line);
  });

  test("the file outline tracks the active editor", async () => {
    const { outline } = await views();
    outline.setScope("file");
    const doc = await vscode.workspace.openTextDocument(
      fixtureUri("source", "main.ptx"),
    );
    await vscode.window.showTextDocument(doc);
    const roots = await waitFor(
      () => {
        const r = outline.getChildren();
        return r.length === 1 && r[0].title === "A Test Book" ? r : undefined;
      },
      10000,
      "the outline of main.ptx",
    );
    assert.strictEqual(roots[0].children[0].title, "Introduction");
  });

  test("Import opens the wizard panel", async () => {
    // With no PreTeXt editor active the command goes straight to the panel
    // rather than asking "insert or new project?".
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("pretext-tools.importProject");
    await waitFor(
      () => {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        return tab?.label === "Import to PreTeXt" ? tab : undefined;
      },
      10000,
      "the import wizard panel",
    );
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });
});
