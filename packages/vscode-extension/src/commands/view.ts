import { commands, extensions, ViewColumn, window, workspace } from "vscode";
import * as utils from "../utils";
import { pretextOutputChannel, pretextTerminal, ptxSBItem } from "../ui";

import { cli } from "../cli";
import { spawn } from "child_process";
import { ensureProjectList, projectTargetList } from "../project";

export function cmdView(runInTerminal: boolean = false) {
  const selectedViewMethod: string =
    workspace.getConfiguration("pretext-tools").get("viewMethod") || "Ask";
  // Create and use a quick-select box if user has not set a configuration for view:
  if (selectedViewMethod === "Ask") {
    let viewMethods = [];
    if (extensions.getExtension("CodeChat.codechat")) {
      viewMethods.push({
        label: "Use CodeChat",
        command: "pretext-tools.viewCodeChat",
      });
    }
    if (viewMethods.length > 0) {
      viewMethods.push({
        label: "Use PreTeXt's view command",
        command: "pretext-tools.viewCLI",
      });
      window.showQuickPick(viewMethods).then((qpSelection) => {
        if (!qpSelection) {
          return;
        }
        commands.executeCommand(qpSelection.command);
      });
    } else {
      commands.executeCommand("pretext-tools.viewCLI", runInTerminal);
    }
  } else {
    // otherwise honor the users setting choice.
    switch (selectedViewMethod) {
      case "CodeChat":
        commands.executeCommand("pretext-tools.viewCodeChat");
        break;
      case "PreTeXT-CLI View":
        commands.executeCommand("pretext-tools.viewCLI", runInTerminal);
        break;
    }
  }
}

export function cmdViewCLI(runInTerminal: boolean = false) {
  ensureProjectList();
  let targetSelection = projectTargetList({});
  // Show choice dialog and pass correct command to runPretext based on selection.
  window.showQuickPick(targetSelection).then((qpSelection) => {
    if (!qpSelection) {
      return;
    }
    const isCodespace = !!process.env.CODESPACES;
    if (runInTerminal || isCodespace) {
      let terminal = utils.setupTerminal(pretextTerminal);
      terminal.sendText("pretext view " + qpSelection.label);
    } else {
      console.log("Viewing " + qpSelection.label);
      runView(qpSelection.label, qpSelection.description);
    }
    // Move selected target to front of list for next command.
    targetSelection = targetSelection.filter((item) => item !== qpSelection);
    targetSelection.unshift(qpSelection);
    return undefined;
  });
}

export function cmdViewCodeChat() {
  if (extensions.getExtension("CodeChat.codechat")) {
    commands.executeCommand("extension.codeChatActivate");
  } else {
    window.showErrorMessage(
      "Unable to start CodeChat preview.  Is the 'CodeChat' extension and CodeChat_Server (through pip) installed?",
    );
  }
}

// The main function to run pretext commands:
function runView(target: string, projectPath: string): void {
  let fullCommand = cli.cmd() + " view " + target;
  let status = "ready"; //for statusbaritem
  let capturedOutput: string[] = [];
  let capturedErrors: string[] = [];
  pretextOutputChannel.clear();
  pretextOutputChannel.appendLine("\n\nNow running `" + fullCommand + "`...");
  const ptxRun = spawn(fullCommand, [], {
    cwd: projectPath,
    shell: true,
  });
  ptxRun.stdout.on("data", function (data) {
    console.log(`stdout: ${data}`);
    data = utils.stripColorCodes(data.toString());
    pretextOutputChannel.appendLine(`${data}`);
    pretextOutputChannel.append(
      "(this local server will remain running until you close vs-code)\n",
    );
    capturedOutput.push(data);
    console.log("Using view. Status should change back");
    utils.updateStatusBarItem(ptxSBItem, "success");
  });
  ptxRun.stderr.on("data", function (data) {
    console.log(`stderr: ${data}`);
    data = utils.stripColorCodes(data.toString());
    capturedErrors.push(data);
  });

  ptxRun.on("close", function (code) {
    console.log(code);
    if (ptxRun.killed) {
      pretextOutputChannel.appendLine("...PreTeXt command terminated early.");
      console.log("Process killed");
    } else {
      pretextOutputChannel.appendLine("...PreTeXt command finished.");
    }
    if (code === 1) {
      console.log("PreTeXt encountered an error; code =", code);
      for (let error of capturedErrors) {
        pretextOutputChannel.appendLine("Collected Errors:\n");
        pretextOutputChannel.appendLine(error);
      }
      window
        .showErrorMessage(
          "PreTeXt encountered one or more errors",
          "Show Log",
          "Dismiss",
        )
        .then((option) => {
          if (option === "Show Log") {
            pretextOutputChannel.show();
          }
        });
    } else {
      console.log("PreTeXt command finished successfully; code =", code);
    }
    utils.updateStatusBarItem(ptxSBItem, status);
  });
}

export async function cmdViewVisualEditor() {
  await commands.executeCommand(
    "vscode.openWith",
    window.activeTextEditor?.document.uri,
    "pretext.visualEditor",
    {
      viewColumn: ViewColumn.Beside,
      preserveFocus: true,
    },
  );
}
