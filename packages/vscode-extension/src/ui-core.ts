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

/**
 * What a click on the idle status-bar item runs: the PreTeXt command menu on
 * the desktop. The browser entry, which registers no such menu, points it at
 * the log instead.
 */
let statusBarReadyCommand = "pretext-tools.selectPretextCommand";

export function setStatusBarReadyCommand(command: string): void {
  statusBarReadyCommand = command;
}

export function updateStatusBarItem(item: StatusBarItem, state?: string): void {
  item.show();
  if (state === "ready" || state === undefined) {
    item.text = `$(debug-run) PreTeXt`;
    item.tooltip = `Run PreTeXt command`;
    item.command = statusBarReadyCommand;
  } else if (state === "running") {
    item.text = `$(loading~spin) PreTeXt`;
    item.tooltip = `running pretext ... (click for log)`;
    item.command = `pretext-tools.showLog`;
  } else if (state === "success") {
    item.text = `$(pass) PreTeXt`;
    item.tooltip = `Success!`;
    item.command = statusBarReadyCommand;
  } else if (state === "error") {
    item.text = `$(warning) PreTeXt`;
    item.tooltip = `Something went wrong; click for log`;
    item.command = `pretext-tools.showLog`;
  }
}
