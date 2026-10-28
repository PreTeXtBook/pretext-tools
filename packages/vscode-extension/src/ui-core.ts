import {
  OutputChannel,
  StatusBarAlignment,
  StatusBarItem,
  window,
} from "vscode";

/**
 * The UI singletons shared by both extension entry points. `ui.ts` re-exports
 * these and adds the desktop-only pieces (terminal, project refresh, status-bar
 * command list), which pull in the CLI wrapper and therefore `child_process`;
 * modules that also ship in the browser bundle import from here instead.
 */

export const pretextOutputChannel: OutputChannel = window.createOutputChannel(
  "PreTeXt Tools",
  "log",
);

export const ptxSBItem: StatusBarItem = window.createStatusBarItem(
  StatusBarAlignment.Left,
  -100,
);
