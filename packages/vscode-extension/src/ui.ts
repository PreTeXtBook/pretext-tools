import { Terminal } from "vscode";
import { updateStatusBarItem } from "./utils";
import { ptxCommandList } from "./constants";
import { resetProjectList } from "./project";
import { Target } from "./types";
import { pretextOutputChannel, ptxSBItem } from "./ui-core";

// The output channel and status-bar item live in ui-core.ts so the browser
// bundle can share them without importing the CLI wrapper below.
export { pretextOutputChannel, ptxSBItem };

export function showLog() {
  pretextOutputChannel.show();
  updateStatusBarItem(ptxSBItem);
}

export async function refreshProjects() {
  pretextOutputChannel.append("Refreshing project/target list.");
  console.log("Refreshing project/target list.");
  //reset projects:
  await resetProjectList();
}

export let pretextTerminal: Terminal;

export let pretextCommandList = ptxCommandList;

export function setTopCommand(command: string) {
  pretextCommandList[0].label = command;
  pretextCommandList[0].description = "";
}

export let lastTarget: Target = {
  name: "",
  path: "",
  standalone: false,
  filename: "",
};

export function updateLastTarget(target: Target) {
  lastTarget = target;
}
