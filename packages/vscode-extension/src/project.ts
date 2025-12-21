import { window, workspace } from "vscode";
import { Project, Target } from "./types";
import { getProjectFolder } from "./utils";
import * as path from "path";
import * as fs from "fs";
import { parseString } from "xml2js";
import { cli } from "./cli";

const DEFAULTMANIFEST = "project.ptx";

export let projects: Project[] = [];

export async function ensureProjectList() {
  if (projects.length === 0) {
    console.log("No projects found, updating project list.");
    await updateProjectList();
  }
}

export async function resetProjectList() {
  projects = [];
  await updateProjectList();
  window.showInformationMessage("Refreshed projects and targets.");
}

export function projectTargetList({
  standalones,
}: {
  standalones?: boolean;
}): { label: string; description: string }[] {
  let targetSelection = [];
  for (let project of projects) {
    for (let target of project.targets) {
      // If standalones is true, only show standalone targets
      if (standalones && !target.standalone) {
        continue;
      }
      // If standalones is false, only show non-standalone targets
      if (!standalones && target.standalone) {
        continue;
      }
      // If no standalones is specified, show all targets
      targetSelection.push({
        label: target.name,
        description: target.path,
      });
    }
  }
  return targetSelection;
}

async function updateProjectList() {
  // Get list of workspace folders:
  if (workspace.workspaceFolders) {
    for (let folder of workspace.workspaceFolders) {
      let root = getProjectFolder(folder.uri.fsPath);
      if (root && !projects.some((p) => p.root === root)) {
        projects.push({
          root: root,
          targets: getTargets({ projectRoot: root }),
        });
      }
    }
  }
  // If we didn't find any projects, look for an active editor and use that to guess a project
  if (projects.length === 0) {
    let root: string | null;
    if (window.activeTextEditor) {
      root = getProjectFolder(window.activeTextEditor.document.uri.fsPath);
    } else {
      root = await userSpecifiedProject();
      console.log("root: ", root);
    }
    if (root) {
      projects.push({
        root: root,
        targets: getTargets({ projectRoot: root }),
      });
    }
  }
  // Always include the default standalone targets from ~/.ptx
  // These should always be standalone targets and we can expect that they will have sensible default output locations.
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    const ptxDir = path.join(homeDir, ".ptx", cli.version());
    console.log("Looking for default project in ", ptxDir);
    if (fs.existsSync(ptxDir)) {
      console.log("Found default project in ", ptxDir);
      projects.push({
        root: ptxDir,
        targets: getTargets({ projectRoot: ptxDir }),
        systemDefault: true,
      });
    }
  }
  return;
}

/**
 * Get the list of targets for a project by parsing the project.ptx file.
 * @param projectRoot The root directory of the project.
 * @returns An array of Target objects.
 */
function getTargets({
  projectRoot,
  manifest,
}: {
  projectRoot: string;
  manifest?: string;
}): Target[] {
  console.log("Getting targets for project root: ", projectRoot);
  if (manifest) {
    console.error(
      "You tried to set a manifest, but this is no longer supported.  Your manifest was: ",
      manifest,
    );
  }
  const projectManifest = path.join(projectRoot, "project.ptx");
  console.log("Project manifest is ", projectManifest);
  if (fs.existsSync(projectManifest)) {
    // Parse the project.ptx xml and look for target elements
    // Return an array of Target objects
    let contents = fs.readFileSync(projectManifest, "utf8");
    // Parse the XML content
    let targets: Target[] = [];
    parseString(contents, (err, result) => {
      if (err) {
        console.error("Error parsing XML: ", err);
        return;
      }

      if (
        result.project &&
        result.project.targets &&
        result.project.targets[0].target
      ) {
        targets = result.project.targets[0].target.map((t: any) => {
          return {
            // The attributes of the target element are given as the children of the $ property
            name: t.$.name,
            path: projectRoot,
            standalone: (t.$.standalone && t.$.standalone !== "no") || false,
          };
        });
      }
    });
    console.log("Targets are ", targets);
    return targets;
  }
  return [];
}

async function userSpecifiedProject() {
  // Open folder select dialog to select project root.
  let root = null;
  await window
    .showInformationMessage(
      "No PreTeXt project found in workspace.  Choose a project folder?",
      {
        modal: true,
        detail:
          "Pick a folder containing the 'project.ptx' manifest of your project.",
      },
      "Choose project folder",
    )
    .then(async (option) => {
      if (option === "Choose project folder") {
        await window
          .showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: "Select project folder...",
            openLabel: "Select",
          })
          .then((uri) => {
            if (uri) {
              root = uri[0].fsPath;
            }
          });
      }
    });
  return root;
}
