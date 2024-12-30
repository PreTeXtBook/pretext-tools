import { window } from "vscode";
import * as utils from "../utils";
import { runPretext } from "./runPtx";
import {
  lastTarget,
  pretextTerminal,
  setTopCommand,
  updateLastTarget,
} from "../ui";
import { cli } from "../cli";
import { ensureProjectList, projects, projectTargetList } from "../project";

export function cmdBuildFile(runInTerminal: boolean = false) {
  // get the active text editor's file name
  let activeEditor = window.activeTextEditor;
  if (!activeEditor) {
    return;
  }
  // Examine current file to see if it has <pretext> as its root element.
  // If not, exit with warning.
  let docText = activeEditor.document.getText();
  if (!docText.includes("<pretext")) {
    window.showErrorMessage(
      "This file does not appear to be a valid complete PreTeXt file. Please open a valid PreTeXt file."
    );
    return;
  }
  let fileName = activeEditor.document.fileName;
  console.log(`Filename:`, fileName);
  if (runInTerminal) {
    let terminal = utils.setupTerminal(pretextTerminal);
    terminal.sendText("pretext build " + fileName);
  } else {
    runPretext(cli.cmd(), "build", fileName);
  }
}

export function cmdBuildAny(runInTerminal: boolean = false) {
  ensureProjectList();
  let targetSelection = projectTargetList();
  // Show choice dialog and pass correct command to runPretext based on selection.
  window.showQuickPick(targetSelection).then((qpSelection) => {
    if (!qpSelection) {
      return;
    }
    if (runInTerminal) {
      let terminal = utils.setupTerminal(
        pretextTerminal,
        qpSelection.description
      );
      terminal.sendText("pretext build " + qpSelection.label);
    } else {
      runPretext(
        cli.cmd(),
        "build",
        qpSelection.label,
        qpSelection.description
      );
    }
    updateLastTarget({
      name: qpSelection.label,
      path: qpSelection.description,
    });
    setTopCommand("Build " + lastTarget.name);
  });
}

export function cmdBuildLast(runInTerminal: boolean = false) {
  ensureProjectList();
  if (runInTerminal) {
    let terminal = utils.setupTerminal(pretextTerminal, projects[0].root);
    terminal.sendText("pretext build");
  } else {
    let projectPath = lastTarget.path;
    if (projectPath === "") {
      //Fix project path if this is the first time default target is called.
      projectPath = projects[0].root;
      console.log("projectPath: ", projectPath);
    }
    runPretext(cli.cmd(), "build", lastTarget.name, projectPath);
  }
}

export function cmdGenerate(runInTerminal: boolean = false) {
  ensureProjectList();
  let targetSelection = projectTargetList();
  // Show choice dialog and pass correct command to runPretext based on selection.
  window.showQuickPick(targetSelection).then((qpSelection) => {
    if (!qpSelection) {
      return;
    }
    if (runInTerminal) {
      let terminal = utils.setupTerminal(pretextTerminal);
      terminal.sendText("pretext generate -t " + qpSelection.label);
    } else {
      runPretext(cli.cmd(), "generate -t", qpSelection.label);
    }
    // Move selected target to front of list for next command.
    targetSelection = targetSelection.filter((item) => item !== qpSelection);
    targetSelection.unshift(qpSelection);
  });
}
