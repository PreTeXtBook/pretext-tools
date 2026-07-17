import { commands, ViewColumn, window, workspace } from "vscode";
import * as utils from "../utils";
import { pretextOutputChannel, pretextTerminal, ptxSBItem } from "../ui";

import { cli } from "../cli";
import { spawn } from "child_process";
import { ensureProjectList, projectTargetList } from "../project";
import { Target } from "../types";

export function cmdView(runInTerminal: boolean = false) {
  const selectedViewMethod: string =
    workspace.getConfiguration("pretext-tools").get("viewMethod") || "Ask";
  switch (selectedViewMethod) {
    case "Live Preview":
      commands.executeCommand("pretext-tools.instantPreview");
      return;
    case "PreTeXT-CLI View":
      commands.executeCommand("pretext-tools.viewCLI", runInTerminal);
      return;
  }
  // "Ask" (default) — also the fallback for retired settings values such as
  // the removed "CodeChat" method.
  let viewMethods = [
    {
      label: "Live preview (side-by-side)",
      command: "pretext-tools.instantPreview",
    },
  ];
  if (
    workspace
      .getConfiguration("pretext-tools")
      .get<boolean>("experimentalFeatures", false)
  ) {
    viewMethods.push({
      label: "Live Preview via CLI build (experimental)",
      command: "pretext-tools.livePreview",
    });
  }
  viewMethods.push({
    label: "Use PreTeXt's view command (external browser)",
    command: "pretext-tools.viewCLI",
  });
  window.showQuickPick(viewMethods).then((qpSelection) => {
    if (!qpSelection) {
      return;
    }
    commands.executeCommand(qpSelection.command);
  });
}

/**
 * View a single target's built output directly, without a quick pick.
 *
 * Shared by `cmdViewCLI`'s quick-pick callback and the Targets tree view's
 * inline view button. Runs `pretext view` in a terminal inside Codespaces (or
 * when asked), otherwise spawns it and streams output to the log.
 */
export function viewTarget(target: Target, runInTerminal: boolean = false) {
  const isCodespace = !!process.env.CODESPACES;
  if (runInTerminal || isCodespace) {
    let terminal = utils.setupTerminal(pretextTerminal);
    terminal.sendText("pretext view " + target.name);
  } else {
    console.log("Viewing " + target.name);
    runView(target.name, target.path);
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
    viewTarget(
      { name: qpSelection.label, path: qpSelection.description },
      runInTerminal,
    );
    // Move selected target to front of list for next command.
    targetSelection = targetSelection.filter((item) => item !== qpSelection);
    targetSelection.unshift(qpSelection);
    return undefined;
  });
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
