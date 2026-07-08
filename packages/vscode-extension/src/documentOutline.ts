/**
 * Document Outline for PreTeXt documents.
 *
 * Provides a tree view in the Activity Bar sidebar that shows the
 * hierarchical structure of the currently open .ptx file:
 * sections, subsections, figures, tables, equations, etc.
 *
 * Each item is clickable and jumps to the corresponding line in the source.
 * The tree updates automatically when the document changes or when a
 * different .ptx file is opened.
 */

import {
  Event,
  EventEmitter,
  Position,
  Range,
  Selection,
  TextDocument,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
  workspace,
  Disposable,
} from "vscode";
import { ELEMENT_CONFIG, OutlineItem, parseOutline } from "./outline-parser";

/**
 * Check if a filename is a PreTeXt source file (.ptx or .xml).
 */
function isPretextFile(fileName: string): boolean {
  return fileName.endsWith(".ptx") || fileName.endsWith(".xml");
}

/**
 * Represents a single node in the document outline tree.
 */
class OutlineNode {
  constructor(
    public readonly tag: string,
    public readonly title: string,
    public readonly xmlId: string,
    public readonly line: number,
    public readonly character: number,
    public readonly children: OutlineNode[],
    public readonly uri: Uri,
  ) {}
}

/**
 * TreeDataProvider that parses a .ptx file and provides the document
 * structure as a tree for the VS Code sidebar.
 */
export class PretextDocumentOutlineProvider implements TreeDataProvider<OutlineNode> {
  private _onDidChangeTreeData = new EventEmitter<
    OutlineNode | undefined | null
  >();
  readonly onDidChangeTreeData: Event<OutlineNode | undefined | null> =
    this._onDidChangeTreeData.event;

  private roots: OutlineNode[] = [];
  private disposables: Disposable[] = [];

  constructor() {
    // Update when the active editor changes
    this.disposables.push(
      window.onDidChangeActiveTextEditor(() => {
        this.refresh();
      }),
    );

    // Update when the document is edited
    this.disposables.push(
      workspace.onDidChangeTextDocument((e) => {
        if (
          window.activeTextEditor &&
          e.document === window.activeTextEditor.document &&
          isPretextFile(e.document.fileName)
        ) {
          this.refresh();
        }
      }),
    );

    // Initial parse
    this.refresh();
  }

  /**
   * Re-parse the current document and refresh the tree.
   */
  refresh(): void {
    const editor = window.activeTextEditor;
    if (editor && isPretextFile(editor.document.fileName)) {
      this.roots = this.parseDocument(editor.document);
    } else {
      this.roots = [];
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: OutlineNode): TreeItem {
    const config = ELEMENT_CONFIG[element.tag];
    const hasChildren = element.children.length > 0;

    const item = new TreeItem(
      this.getDisplayLabel(element),
      hasChildren
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.None,
    );

    // Set icon
    if (config) {
      item.iconPath = new ThemeIcon(config.icon);
    }

    // Set tooltip
    if (element.xmlId) {
      item.tooltip = `${config?.label || element.tag}: ${element.title}\nxml:id="${element.xmlId}"`;
    } else {
      item.tooltip = `${config?.label || element.tag}: ${element.title}`;
    }

    // Set description (shown dimmed to the right of the label)
    if (element.xmlId) {
      item.description = element.xmlId;
    }

    // Click to jump to source line
    item.command = {
      command: "pretext-tools.outlineJumpToLine",
      title: "Go to",
      arguments: [element],
    };

    return item;
  }

  getChildren(element?: OutlineNode): OutlineNode[] {
    if (!element) {
      return this.roots;
    }
    return element.children;
  }

  /**
   * Generate a human-readable label for the tree item.
   */
  private getDisplayLabel(node: OutlineNode): string {
    if (node.title) {
      return node.title;
    }
    const config = ELEMENT_CONFIG[node.tag];
    if (config) {
      return config.label;
    }
    return node.tag;
  }

  /**
   * Parse a .ptx document into a tree of OutlineNodes.
   *
   * The parsing itself lives in the vscode-free `outline-parser` module; here
   * we just attach the document `Uri` to each parsed item so the tree items can
   * navigate back to the source.
   */
  private parseDocument(document: TextDocument): OutlineNode[] {
    const items = parseOutline(document.getText());
    return items.map((item) => this.toNode(item, document.uri));
  }

  /** Recursively convert a parsed {@link OutlineItem} into a `vscode` OutlineNode. */
  private toNode(item: OutlineItem, uri: Uri): OutlineNode {
    return new OutlineNode(
      item.tag,
      item.title,
      item.xmlId,
      item.line,
      item.character,
      item.children.map((child) => this.toNode(child, uri)),
      uri,
    );
  }

  /**
   * Dispose of event listeners.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

/**
 * Command handler: jump to the source line of an outline node.
 */
export function cmdOutlineJumpToLine(node: OutlineNode): void {
  if (!node) {
    return;
  }

  // Find the document — it might not be the active editor
  const editor = window.activeTextEditor;
  if (editor && editor.document.uri.toString() === node.uri.toString()) {
    const pos = new Position(node.line, node.character);
    editor.revealRange(new Range(pos, pos), 2); // InCenter
    editor.selection = new Selection(pos, pos);
    // Also focus the editor (in case the sidebar has focus)
    window.showTextDocument(editor.document, editor.viewColumn);
  } else {
    // Open the document
    workspace.openTextDocument(node.uri).then((doc) => {
      window.showTextDocument(doc).then((ed) => {
        const pos = new Position(node.line, node.character);
        ed.revealRange(new Range(pos, pos), 2);
        ed.selection = new Selection(pos, pos);
      });
    });
  }
}
