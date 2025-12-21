import { Terminal, window } from "vscode";
import * as utils from "../utils";
import { runPretext } from "./runPtx";
import { cli } from "../cli";
import { ensureProjectList, projects } from "../project";

export async function cmdDeploy(
  runInTerminal: boolean = false,
  pretextTerminal: Terminal | null = null,
) {
  // First get a list of possible projects to deploy.
  await ensureProjectList();
  let projectRoots = projects
    .filter((p) => !p.systemDefault)
    .map((p) => p.root);
  console.log("projectRoots: ", projectRoots);
  let projectPath = "."; // default to current directory
  if (projectRoots.length === 0) {
    window.showErrorMessage(
      "No projects found. Please add a project folder to your workspace.",
    );
    return;
  } else if (projectRoots.length === 1) {
    // In most cases, there will be only one project, so pick that.
    projectPath = projectRoots[0];
  } else {
    // Otherwise, show a list of projects and let the user pick one.
    window.showQuickPick(projectRoots).then((qpSelection) => {
      if (!qpSelection) {
        return;
      }
      projectPath = qpSelection;
    });
  }
  // Now do the deplo   y, using the requested method.
  if (runInTerminal) {
    pretextTerminal = utils.setupTerminal(pretextTerminal, projectPath);
    pretextTerminal.sendText("pretext deploy");
  } else {
    console.log("Deploying project at: ", projectPath);
    runPretext(cli.cmd(), "deploy", "-u", projectPath);
  }
}
