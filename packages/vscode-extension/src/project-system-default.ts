import { Uri, workspace } from "vscode";
import * as path from "path";
import { cli } from "./cli";
import { projectAt } from "./project";
import { Project } from "./types";

/**
 * The CLI's bundled standalone templates under `~/.ptx/<version>`, offered as
 * a project of their own: always standalone targets, with sensible default
 * output locations. Desktop only — it needs the CLI's version and a home
 * directory — so extension.ts registers it with `addProjectProvider` and the
 * browser entry point never sees it.
 */
export async function systemDefaultProjects(): Promise<Project[]> {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) {
    return [];
  }
  const ptxDir = Uri.file(path.join(homeDir, ".ptx", cli.version()));
  console.log("Looking for default project in ", ptxDir.fsPath);
  try {
    await workspace.fs.stat(ptxDir);
  } catch {
    return [];
  }
  console.log("Found default project in ", ptxDir.fsPath);
  return [{ ...(await projectAt(ptxDir)), systemDefault: true }];
}
