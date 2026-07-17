/**
 * Targets view for the PreTeXt sidebar.
 *
 * Lists the build targets discovered in the workspace's `project.ptx`
 * (see `project.ts` / `project-manifest.ts`), one row per non-standalone
 * target. Each row shows the target's output format and exposes inline
 * build (▶) and view (👁) buttons; clicking the row itself opens the target's
 * definition in `project.ptx`.
 */

import {
  EventEmitter,
  Position,
  Range,
  Selection,
  TextEditorRevealType,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
  workspace,
} from "vscode";
import * as path from "path";
import { ensureProjectList, projects } from "./project";
import { Target } from "./types";

/** Wraps a {@link Target} so tree rows carry a stable object identity. */
export class TargetNode {
  constructor(public readonly target: Target) {}
}

export class PretextTargetsProvider implements TreeDataProvider<TargetNode> {
  private _onDidChangeTreeData = new EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Re-query the tree, e.g. after `project.ptx` changes. */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: TargetNode): TreeItem {
    const item = new TreeItem(node.target.name, TreeItemCollapsibleState.None);
    item.description = node.target.format ?? "";
    item.iconPath = new ThemeIcon("target");
    item.tooltip = node.target.format
      ? `Target "${node.target.name}" (${node.target.format}) in ${node.target.path}`
      : `Target "${node.target.name}" in ${node.target.path}`;
    // Matched by the `view/item/context` menu entries in package.json to render
    // the inline build/view buttons.
    item.contextValue = "target";
    item.command = {
      command: "pretext-tools.revealTargetDefinition",
      title: "Open definition",
      arguments: [node],
    };
    return item;
  }

  async getChildren(node?: TargetNode): Promise<TargetNode[]> {
    if (node) {
      return [];
    }
    await ensureProjectList();
    return projects
      .filter((p) => !p.systemDefault) // hide the ~/.ptx templates
      .flatMap((p) => p.targets)
      .filter((t) => !t.standalone)
      .map((t) => new TargetNode(t));
  }
}

/**
 * Command handler: open `project.ptx` and jump to the selected target's
 * definition.
 */
export async function cmdRevealTargetDefinition(node: TargetNode) {
  if (!node) {
    return;
  }
  const manifest = Uri.file(path.join(node.target.path, "project.ptx"));
  const doc = await workspace.openTextDocument(manifest);
  const editor = await window.showTextDocument(doc);
  const offset = doc.getText().indexOf(`name="${node.target.name}"`);
  if (offset >= 0) {
    const pos = doc.positionAt(offset);
    editor.revealRange(new Range(pos, pos), TextEditorRevealType.InCenter);
    editor.selection = new Selection(pos, pos);
  } else {
    const start = new Position(0, 0);
    editor.revealRange(new Range(start, start), TextEditorRevealType.AtTop);
  }
}
