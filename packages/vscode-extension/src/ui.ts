import {
  OutputChannel,
  StatusBarAlignment,
  StatusBarItem,
  Terminal,
  window,
} from "vscode";
import { updateStatusBarItem } from "./utils";
import { ptxCommandList } from "./constants";
import { resetProjectList } from "./project";
import { Target } from "./types";

export const pretextOutputChannel: OutputChannel = window.createOutputChannel(
  "PreTeXt Tools",
  "log",
);
export const ptxSBItem: StatusBarItem = window.createStatusBarItem(
  StatusBarAlignment.Left,
  -100,
);

export function showLog() {
  pretextOutputChannel.show();
  updateStatusBarItem(ptxSBItem);
}

export function refreshProjects() {
  pretextOutputChannel.append("Refreshing project/target list.");
  console.log("Refreshing project/target list.");
  //reset projects:
  resetProjectList();
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
