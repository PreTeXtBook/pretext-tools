/**
 * The Outline and Targets views on the desktop host, through the providers
 * the extension's `activate` returns. Project discovery goes through
 * `workspace.fs` on both hosts now (see src/project.ts); this keeps the
 * `file:` side of it covered, the web suite covers the virtual one.
 */
import * as assert from "assert";
import * as vscode from "vscode";

const EXTENSION_ID = "oscarlevin.pretext-tools";

interface OutlineNodeLike {
  title: string;
  uri: vscode.Uri;
  children: OutlineNodeLike[];
}
interface TargetNodeLike {
  target: { name: string; format?: string; path: string };
}
interface Views {
  outline: {
    getChildren(node?: OutlineNodeLike): OutlineNodeLike[];
    setScope(scope: "file" | "project"): void;
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

async function waitFor<T>(
  probe: () => T | undefined,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

suite("Project views", () => {
  suiteTeardown(async () => {
    (await views()).outline.setScope("file");
  });

  test("the Targets view lists the manifest's targets", async () => {
    const { targets } = await views();
    const nodes = await targets.getChildren();
    assert.deepStrictEqual(nodes.map((n) => n.target.name).sort(), [
      "includes",
      "print",
      "web",
    ]);
    const print = nodes.find((n) => n.target.name === "print")!;
    assert.strictEqual(targets.getTreeItem(print).description, "pdf");
    // Roots are real filesystem paths on this host.
    assert.strictEqual(
      vscode.Uri.file(print.target.path).fsPath,
      vscode.workspace.workspaceFolders![0].uri.fsPath,
    );
  });

  test("the project outline follows xi:includes", async () => {
    const { outline } = await views();
    outline.setScope("project");
    const groups = await waitFor(
      () => {
        const roots = outline.getChildren();
        return roots.length === 2 ? roots : undefined;
      },
      20000,
      "a project outline with one group per target source",
    );
    const group = groups.find((g) => g.title.endsWith("with-includes.ptx"));
    assert.ok(
      group,
      `expected a with-includes.ptx group, got ${groups.map((g) => g.title)}`,
    );
    const chapter = group!.children[0].children[0];
    assert.strictEqual(chapter.title, "An Included Chapter");
    assert.ok(chapter.uri.fsPath.endsWith("ch1.ptx"), chapter.uri.toString());
  });
});
