/**
 * Actions view for the PreTeXt sidebar.
 *
 * A static list of the most common PreTeXt commands, so they're reachable with
 * one click from the sidebar instead of through the command palette or the
 * "PreTeXt" status-bar quick pick. Clicking a row runs its command directly.
 */

import {
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";

interface Action {
  label: string;
  command: string;
  icon: string; // codicon name
  tooltip?: string;
  /**
   * Available in the browser host (github.dev / vscode.dev). Defaults to
   * false: most actions drive the `pretext` CLI, which only exists on desktop
   * and in Codespaces.
   */
  web?: boolean;
}

const ACTIONS: Action[] = [
  {
    label: "Build last target",
    command: "pretext-tools.buildLast",
    icon: "run",
    tooltip: "Build the most recent (or default) target",
  },
  {
    label: "Build current file",
    command: "pretext-tools.buildFile",
    icon: "file-binary",
    tooltip: "Build the active file as a standalone document",
  },
  {
    label: "View output",
    command: "pretext-tools.view",
    icon: "open-preview",
    tooltip: "View built output (choose or use your configured method)",
  },
  {
    label: "Live preview",
    command: "pretext-tools.instantPreview",
    icon: "zap",
    tooltip: "Open a live side-by-side HTML preview that refreshes on save",
    web: true,
  },
  {
    label: "Format document",
    command: "pretext-tools.format",
    icon: "pencil",
    tooltip: "Formats the PreTeXt source file using the PreTeXt formatter",
    web: true,
  },
  {
    label: "Generate assets",
    command: "pretext-tools.generate",
    icon: "symbol-color",
  },
  {
    label: "Deploy to GitHub",
    command: "pretext-tools.deploy",
    icon: "cloud-upload",
  },
  {
    label: "New project…",
    command: "pretext-tools.new",
    icon: "new-folder",
  },
  {
    label: "Import project…",
    command: "pretext-tools.importProject",
    icon: "package",
    web: true,
  },
  {
    label: "Convert to PreTeXt…",
    command: "pretext-tools.convertText",
    icon: "replace",
    web: true,
  },
  {
    label: "Update PreTeXt",
    command: "pretext-tools.updatePTX",
    icon: "arrow-up",
  },
  {
    label: "Getting started",
    command: "pretext-tools.gettingStarted",
    icon: "mortar-board",
    web: true,
  },
  {
    label: "Show log",
    command: "pretext-tools.showLog",
    icon: "output",
    web: true,
  },
];

export class PretextActionsProvider implements TreeDataProvider<Action> {
  private readonly actions: Action[];

  /** `web: true` lists only the actions that work in the browser host. */
  constructor({ web = false }: { web?: boolean } = {}) {
    this.actions = web ? ACTIONS.filter((a) => a.web) : ACTIONS;
  }

  getTreeItem(action: Action): TreeItem {
    const item = new TreeItem(action.label, TreeItemCollapsibleState.None);
    item.iconPath = new ThemeIcon(action.icon);
    item.tooltip = action.tooltip ?? action.label;
    item.command = { command: action.command, title: action.label };
    return item;
  }

  getChildren(action?: Action): Action[] {
    return action ? [] : this.actions;
  }
}
