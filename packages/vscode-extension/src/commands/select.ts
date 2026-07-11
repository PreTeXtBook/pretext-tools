import { commands, window } from "vscode";
import { pretextCommandList } from "../ui";

export function cmdSelectCommand(runInTerminal: boolean = false) {
  // Switch commands between modes:
  if (runInTerminal) {
    for (let command of pretextCommandList) {
      command.label = command.label.replace(" (terminal)", "");
      command.label = command.label + " (terminal)";
    }
    pretextCommandList[pretextCommandList.length - 1] = {
      label: "Run commands in quiet mode",
      description: "(default mode)",
      command: "pretext-tools.selectPretextCommand",
    };
  } else {
    for (let command of pretextCommandList) {
      command.label = command.label.replace(" (terminal)", "");
      pretextCommandList[pretextCommandList.length - 1] = {
        label: "Run commands in terminal mode",
        description: "Use to debug a failed command",
        command: "pretext-tools.selectPretextCommand",
      };
    }
  }
  // Open quickpick and execute command
  window.showQuickPick(pretextCommandList).then((qpSelection) => {
    if (!qpSelection) {
      return;
    }
    if (qpSelection.command === "pretext-tools.selectPretextCommand") {
      commands.executeCommand(qpSelection.command, !runInTerminal);
    } else {
      commands.executeCommand(qpSelection.command, runInTerminal);
    }
  });
}
