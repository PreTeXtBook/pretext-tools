import { Uri, window, workspace } from "vscode";
import { Project, Target } from "./types";
import { parseTargetsFromManifest } from "./project-manifest";
import { uriToPath } from "./virtual-path";

// Project discovery reads through `workspace.fs` and keeps each root as a path
// in the space virtual-path.ts defines, so the same code finds a project on
// disk and in a virtual workspace (github.dev). Nothing here may import the
// CLI or a Node built-in: the browser entry point depends on this module.

const DEFAULTMANIFEST = "project.ptx";

export let projects: Project[] = [];

/**
 * Hosts can contribute projects the workspace does not contain. The desktop
 * host adds the CLI's standalone templates under `~/.ptx`
 * (project-system-default.ts); the browser host has nowhere to find them.
 */
type ProjectProvider = () => Promise<Project[]>;
const projectProviders: ProjectProvider[] = [];

export function addProjectProvider(provider: ProjectProvider): void {
  projectProviders.push(provider);
}

export async function ensureProjectList() {
  if (projects.length === 0) {
    console.log("No projects found, updating project list.");
    await updateProjectList();
  }
}

export async function resetProjectList({
  silent = false,
}: { silent?: boolean } = {}) {
  projects = [];
  await updateProjectList();
  if (!silent) {
    window.showInformationMessage("Refreshed projects and targets.");
  }
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
    for (const folder of workspace.workspaceFolders) {
      const root = await findProjectRoot(folder.uri);
      if (root && !projects.some((p) => p.root === rootPath(root))) {
        projects.push(await projectAt(root));
      }
    }
  }
  // If we didn't find any projects, look for an active editor and use that to guess a project
  if (projects.length === 0) {
    let root: Uri | undefined;
    if (window.activeTextEditor) {
      root = await findProjectRoot(
        parentFolder(window.activeTextEditor.document.uri),
      );
    } else {
      root = await userSpecifiedProject();
      console.log("root: ", root?.toString());
    }
    if (root) {
      projects.push(await projectAt(root));
    }
  }
  for (const provider of projectProviders) {
    projects.push(...(await provider()));
  }
}

/**
 * The nearest folder at or above `dir` holding a `project.ptx`, or undefined
 * if the top of the tree is reached without finding one.
 */
export async function findProjectRoot(dir: Uri): Promise<Uri | undefined> {
  for (;;) {
    if (await exists(Uri.joinPath(dir, DEFAULTMANIFEST))) {
      return dir;
    }
    const parent = parentFolder(dir);
    if (parent.toString() === dir.toString()) {
      return undefined;
    }
    dir = parent;
  }
}

/** The folder containing `uri` (the root is its own parent). */
function parentFolder(uri: Uri): Uri {
  const trimmed = uri.path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return uri.with({ path: slash <= 0 ? "/" : trimmed.slice(0, slash) });
}

async function exists(uri: Uri): Promise<boolean> {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** The project rooted at `root`, with the targets its manifest declares. */
export async function projectAt(root: Uri): Promise<Project> {
  return { root: rootPath(root), targets: await getTargets(root) };
}

function rootPath(root: Uri): string {
  return uriToPath(root.toString());
}

/**
 * Get the list of targets for a project by parsing its project.ptx file.
 * @param root The root folder of the project.
 * @returns An array of Target objects.
 */
async function getTargets(root: Uri): Promise<Target[]> {
  const projectManifest = Uri.joinPath(root, DEFAULTMANIFEST);
  console.log("Project manifest is ", projectManifest.toString());
  let contents: string;
  try {
    contents = new TextDecoder().decode(
      await workspace.fs.readFile(projectManifest),
    );
  } catch {
    return [];
  }
  // Parse the project.ptx xml and look for target elements
  const targets = parseTargetsFromManifest(contents, rootPath(root));
  console.log("Targets are ", targets);
  return targets;
}

async function userSpecifiedProject(): Promise<Uri | undefined> {
  // Open folder select dialog to select project root.
  const option = await window.showInformationMessage(
    "No PreTeXt project found in workspace.  Choose a project folder?",
    {
      modal: true,
      detail:
        "Pick a folder containing the 'project.ptx' manifest of your project.",
    },
    "Choose project folder",
  );
  if (option !== "Choose project folder") {
    return undefined;
  }
  const picked = await window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: "Select project folder...",
    openLabel: "Select",
  });
  return picked?.[0];
}
