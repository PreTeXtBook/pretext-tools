import { window, workspace } from "vscode";
import * as utils from "./utils";
import { execSync } from "child_process";
import { cmdUpdate } from "./commands/update";

interface CLI {
  _pythonPath: string | null | undefined;
  _pretextVersion: string | null;
  _cmd: string | null;
  pythonPath: (override?: string | null) => string | undefined;
  cmd: () => string;
  version: () => string;
}

export let cli: CLI = {
  _pythonPath: null,
  _cmd: null,
  _pretextVersion: null,
  pythonPath: function (override?: string | null) {
    if (override) {
      this._pythonPath = override;
    }
    if (this._pythonPath === null) {
      this._pythonPath = getPythonExec();
    }
    return this._pythonPath;
  },
  cmd: function () {
    if (this._cmd === null) {
      this._cmd = getPtxExec();
    }
    return this._cmd;
  },
  version: function () {
    if (this._pretextVersion === null) {
      this._pretextVersion = getPtxVersion();
    }
    return this._pretextVersion;
  },
};

function getPythonExec(): string | undefined {
  let pythonExec: string | undefined = workspace
    .getConfiguration("pretext-tools")
    .get("pythonPath");
  console.log("Python path from settings: ", pythonExec);
  if (pythonExec === "") {
    for (let command of ["python3", "python"]) {
      try {
        let pythonVersion = execSync(command + " --version").toString();
        console.log("Python version result: ", pythonVersion);
        if (pythonVersion.toLowerCase().includes("python 2")) {
          throw new Error(command + " is python 2");
        }
        pythonExec = command;
        break;
      } catch (err) {
        console.log("Error: ", err);
      }
    }
  } else {
    try {
      let pythonVersion = execSync(pythonExec + " --version").toString();
      console.log("Python version result: ", pythonVersion);
      if (pythonVersion.toLowerCase().includes("python 2")) {
        throw new Error(pythonExec + " is python 2");
      }
    } catch (err) {
      console.log("Error: ", err);
      window.showErrorMessage(
        "The path to python provided in settings does not appear to be a valid python 3 executable.  Please provide a valid path to python.",
      );
      pythonExec = "";
    }
  }
  if (pythonExec === "") {
    window.showErrorMessage(
      "You do not appear to have python installed.  Please download and install python (and make sure it is added to your PATH).",
    );
    return undefined;
  }
  return pythonExec;
}

function getPtxExec() {
  let pythonExec = cli.pythonPath();
  if (!pythonExec) {
    window.showErrorMessage(
      "Unable to run PreTeXt without python.  Please install python and try again.",
    );
  } else {
    console.log("Using python at ", pythonExec);
    let ptxCommand = pythonExec + " -m pretext";
    try {
      let ptxVersion = execSync(ptxCommand + " --version").toString();
      console.log("Using PreTeXt version", ptxVersion);
      return ptxCommand;
    } catch (err) {
      console.log(ptxCommand + " not found");
    }
  }
  // If the above did not work, then either pretext has been installed with pipx, is not yet installed, or python is not available in the usual place, so we try a last ditch effort to find it.
  let ptxExec = "";
  for (let command of ["pretext", "python -m pretext", "python3 -m pretext"]) {
    try {
      let ptxVersion = execSync(command + " --version").toString();
      console.log("Using PreTeXt version", ptxVersion);
      return command;
    } catch (err) {
      console.log(command + " not found");
    }
  }
  if (
    ptxExec === "" &&
    workspace.getConfiguration("pretext-tools").get("installPretext")
  ) {
    window
      .showWarningMessage(
        "It doesn't look like you have pretext installed.  Would you like to try to install it now?",
        "Yes",
        "No",
        "No (stop asking)",
      )
      .then((option) => {
        if (option === "Yes") {
          try {
            cmdUpdate();
            console.log("Finished attempting to install PreTeXt");
            return getPtxExec();
          } catch (err) {
            console.log("Unable to install PreTeXt.  Error: ", err);
          }
        } else if (option === "No (stop asking)") {
          workspace
            .getConfiguration("pretext-tools")
            .update("installPretext", false);
        }
      });
  }
  return ptxExec;
}

function getPtxVersion() {
  let ptxVersion = "version unknown";
  try {
    ptxVersion = execSync(cli.cmd() + " --version")
      .toString()
      .trim();
    if (ptxVersion.includes("\n")) {
      ptxVersion = ptxVersion.split("\n")[-1];
    }
  } catch (err) {
    console.log("Error: ", err);
  }
  return ptxVersion;
}
