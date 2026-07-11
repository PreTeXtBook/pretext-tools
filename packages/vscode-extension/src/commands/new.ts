import { window } from "vscode";
import { runThenOpen } from "./runPtx";
import { cli } from "../cli";
import * as fs from "fs";
import * as path from "path";
import { util } from "prettier";
import { get } from "http";
import { getProjectFolder } from "../utils";

export function cmdNew() {
  let viewCommand = [];
  for (let template of ["article", "book", "course", "slideshow", "demo"]) {
    viewCommand.push({
      label: template,
      description: "New " + template,
    });
  }
  // Show choice dialog and pass correct command to runPretext based on selection.
  window.showQuickPick(viewCommand).then((qpSelection) => {
    if (!qpSelection) {
      return;
    }
    window
      .showOpenDialog({
        openLabel: "Select folder",
        canSelectMany: false,
        canSelectFiles: false,
        canSelectFolders: true,
      })
      .then((fileUri) => {
        if (fileUri && fileUri[0]) {
          var projectFolder = fileUri[0].fsPath;
          if (getProjectFolder(projectFolder)) {
            window
              .showWarningMessage(
                "The selected folder is already part of a PreTeXt project. Please select a different folder.",
                { modal: true },
                "Try Again",
              )
              .then((selection) => {
                if (selection === "Try Again") {
                  cmdNew(); // Restart the process
                  return;
                }
              });
            return; // Exit if the user chooses to cancel
          }
          console.log("Selected folder: ", projectFolder);
          runThenOpen(
            cli.cmd(),
            "new",
            qpSelection.label + " -d .",
            fileUri[0],
          );
        }
      });
  });
}
