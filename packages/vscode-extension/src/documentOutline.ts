/**
 * Document Outline for PreTeXt documents.
 *
 * Provides a tree view in the Activity Bar sidebar that shows the
 * hierarchical structure of a PreTeXt document: parts, chapters, sections, and
 * the other structural divisions (front/back matter, appendices, exercises,
 * glossary, …).
 *
 * The view has two scopes, toggled from its title bar:
 *  - **file** (default): the active `.ptx` file only, updated as you type.
 *  - **project**: the whole project, following `xi:include`s from every
 *    target's source file declared in `project.ptx`, updated on save.
 *
 * Each item is clickable and jumps to the corresponding line in its source
 * file (which, in project scope, may be a different file than the active one).
 */

import {
  Event,
  EventEmitter,
  ExtensionContext,
  Position,
  Range,
  Selection,
  TextDocument,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  commands,
  window,
  workspace,
  Disposable,
} from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ELEMENT_CONFIG, OutlineItem, parseOutline } from "./outline-parser";
import { FileOutlineItem, parseProjectOutline } from "./project-outline";
import { ensureProjectList, projects } from "./project";

type OutlineScope = "file" | "project";

/** Key used for both `workspaceState` persistence and the `when`-clause context. */
const SCOPE_STATE_KEY = "pretextOutline.scope";
const SCOPE_CONTEXT_KEY = "pretextOutline.scope";

/**
 * Check if a filename is a PreTeXt source file (.ptx or .xml).
 */
function isPretextFile(fileName: string): boolean {
  return fileName.endsWith(".ptx") || fileName.endsWith(".xml");
}

/**
 * Read a file's text, preferring an open editor's (possibly unsaved) content
 * over what's on disk. Returns undefined if the file can't be read.
 */
async function readProjectFile(absPath: string): Promise<string | undefined> {
  const open = workspace.textDocuments.find((d) => d.uri.fsPath === absPath);
  if (open) {
    return open.getText();
  }
  try {
    return await fs.promises.readFile(absPath, "utf8");
  } catch {
    return undefined;
  }
}

type NodeKind = "element" | "group" | "missing";

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
    /** "group" = a per-source header (project scope); "missing" = unreadable include. */
    public readonly kind: NodeKind = "element",
    /** Extra info: target names for a group, or the href for a missing include. */
    public readonly detail: string = "",
  ) {}
}

/**
 * TreeDataProvider that parses PreTeXt source and provides the document
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
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private scope: OutlineScope;
  /** Bumped on each rebuild so a slow async (project) rebuild can't overwrite a newer one. */
  private rebuildToken = 0;

  constructor(private readonly context: ExtensionContext) {
    this.scope = context.workspaceState.get<OutlineScope>(
      SCOPE_STATE_KEY,
      "file",
    );
    void commands.executeCommand("setContext", SCOPE_CONTEXT_KEY, this.scope);

    // Update when a PreTeXt editor becomes active (file scope only — the
    // project outline doesn't depend on which file is focused). When focus
    // moves to a non-editor (Live Preview webview, output panel, visual
    // editor), `activeTextEditor` is undefined; keep the last outline.
    this.disposables.push(
      window.onDidChangeActiveTextEditor((editor) => {
        if (
          this.scope === "file" &&
          editor &&
          isPretextFile(editor.document.fileName)
        ) {
          this.refresh();
        }
      }),
    );

    // File scope: update as the active document is edited (debounced).
    this.disposables.push(
      workspace.onDidChangeTextDocument((e) => {
        if (
          this.scope === "file" &&
          window.activeTextEditor &&
          e.document === window.activeTextEditor.document &&
          isPretextFile(e.document.fileName)
        ) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => this.refresh(), 300);
        }
      }),
    );

    // Project scope: the tree spans files that aren't the active editor, so we
    // can't react to every keystroke — rebuild when any .ptx/.xml is saved.
    this.disposables.push(
      workspace.onDidSaveTextDocument((doc) => {
        if (this.scope === "project" && isPretextFile(doc.fileName)) {
          this.refresh();
        }
      }),
    );

    // Initial parse
    this.refresh();
  }

  /** Switch between the single-file and whole-project outline. */
  setScope(scope: OutlineScope): void {
    if (this.scope === scope) {
      return;
    }
    this.scope = scope;
    void this.context.workspaceState.update(SCOPE_STATE_KEY, scope);
    void commands.executeCommand("setContext", SCOPE_CONTEXT_KEY, scope);
    this.refresh();
  }

  /**
   * Rebuild the tree. Fire-and-forget wrapper so it stays a plain command
   * callback; the heavy lifting (which is async in project scope) happens in
   * {@link rebuild}.
   */
  refresh(): void {
    void this.rebuild();
  }

  private async rebuild(): Promise<void> {
    const token = ++this.rebuildToken;
    if (this.scope === "project") {
      const roots = await this.buildProjectRoots();
      if (token !== this.rebuildToken) {
        return; // a newer refresh started while we were reading files
      }
      this.roots = roots;
    } else {
      const editor = window.activeTextEditor;
      if (editor && isPretextFile(editor.document.fileName)) {
        this.roots = this.parseDocument(editor.document);
      }
      // else: keep the previous outline rather than blanking it.
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: OutlineNode): TreeItem {
    const hasChildren = element.children.length > 0;
    const collapsible = hasChildren
      ? TreeItemCollapsibleState.Expanded
      : TreeItemCollapsibleState.None;

    if (element.kind === "group") {
      const item = new TreeItem(element.title, collapsible);
      item.iconPath = new ThemeIcon("files");
      item.description = element.detail;
      item.tooltip = element.detail
        ? `Source: ${element.title}\nTargets: ${element.detail}`
        : `Source: ${element.title}`;
      item.command = {
        command: "pretext-tools.outlineJumpToLine",
        title: "Open source file",
        arguments: [element],
      };
      return item;
    }

    if (element.kind === "missing") {
      const item = new TreeItem(element.title, TreeItemCollapsibleState.None);
      item.iconPath = new ThemeIcon("warning");
      item.tooltip = `Included file not found: ${element.detail || element.title}`;
      item.command = {
        command: "pretext-tools.outlineJumpToLine",
        title: "Go to include",
        arguments: [element],
      };
      return item;
    }

    const config = ELEMENT_CONFIG[element.tag];
    const item = new TreeItem(this.getDisplayLabel(element), collapsible);

    if (config) {
      item.iconPath = new ThemeIcon(config.icon);
    }

    if (element.xmlId) {
      item.tooltip = `${config?.label || element.tag}: ${element.title}\nxml:id="${element.xmlId}"`;
      item.description = element.xmlId;
    } else {
      item.tooltip = `${config?.label || element.tag}: ${element.title}`;
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
   * Parse the active document (file scope) into a tree of OutlineNodes. The
   * parsing itself lives in the vscode-free `outline-parser` module; here we
   * just attach the document `Uri` so items can navigate back to the source.
   */
  private parseDocument(document: TextDocument): OutlineNode[] {
    const items = parseOutline(document.getText());
    return items.map((item) => this.toNode(item, document.uri));
  }

  /**
   * Build the whole-project outline (project scope): the outline of every
   * distinct source file across `project.ptx`'s targets, following each file's
   * `xi:include`s. When a single source backs every target (the common case)
   * its divisions are shown directly; when targets use different sources, each
   * source gets a header row.
   */
  private async buildProjectRoots(): Promise<OutlineNode[]> {
    await ensureProjectList();

    // Distinct source files, mapped to the target names that use them.
    const bySource = new Map<string, string[]>();
    for (const project of projects) {
      if (project.systemDefault) {
        continue; // skip the ~/.ptx templates
      }
      for (const target of project.targets) {
        if (target.standalone || !target.source) {
          continue;
        }
        const names = bySource.get(target.source);
        if (names) {
          names.push(target.name);
        } else {
          bySource.set(target.source, [target.name]);
        }
      }
    }

    const sources = [...bySource.keys()];
    if (sources.length === 0) {
      // A project exists but declares no target sources (empty/odd manifest):
      // fall back to the conventional source/main.ptx under each project root.
      for (const project of projects) {
        if (!project.systemDefault) {
          sources.push(path.join(project.root, "source", "main.ptx"));
        }
      }
    }
    if (sources.length === 0) {
      return []; // no project → the view's welcome content shows
    }

    if (sources.length === 1) {
      const items = await parseProjectOutline(sources[0], readProjectFile);
      return items.map((item) => this.toNode(item, Uri.file(sources[0])));
    }

    // Multiple distinct sources → group each under a header row.
    const groups: OutlineNode[] = [];
    for (const source of sources) {
      const items = await parseProjectOutline(source, readProjectFile);
      const children = items.map((item) => this.toNode(item, Uri.file(source)));
      groups.push(
        new OutlineNode(
          "project-source",
          workspace.asRelativePath(source),
          "",
          0,
          0,
          children,
          Uri.file(source),
          "group",
          (bySource.get(source) ?? []).join(", "),
        ),
      );
    }
    return groups;
  }

  /**
   * Recursively convert a parsed {@link OutlineItem} into a `vscode`
   * OutlineNode. In project scope each item carries its own source `file`
   * (via {@link FileOutlineItem}); otherwise the passed `uri` is used.
   */
  private toNode(item: OutlineItem, uri: Uri): OutlineNode {
    const file = (item as FileOutlineItem).file;
    const itemUri = file ? Uri.file(file) : uri;
    const kind: NodeKind = item.tag === "missing" ? "missing" : "element";
    const detail = item.tag === "missing" ? (item.href ?? "") : "";
    return new OutlineNode(
      item.tag,
      item.title,
      item.xmlId,
      item.line,
      item.character,
      item.children.map((child) => this.toNode(child, itemUri)),
      itemUri,
      kind,
      detail,
    );
  }

  /**
   * Dispose of event listeners.
   */
  dispose(): void {
    clearTimeout(this.refreshTimer);
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
