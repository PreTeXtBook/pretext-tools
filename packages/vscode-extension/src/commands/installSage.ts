import { ProgressLocation, window, workspace } from "vscode";
import { pretextOutputChannel } from "../ui";
import { spawn } from "child_process";
import { getProjectFolder } from "../utils";
const { exec } = require("child_process");
const fs = require("fs");

export async function cmdInstallSage() {
  console.log("Trying to install Sage");
  if (process.env.CODESPACES === "true") {
    console.log("Running inside a GitHub Codespace");
    const cwd =
      getProjectFolder(workspace.workspaceFolders![0].uri.fsPath) ||
      process.env.GITHUB_WORKSPACE ||
      process.cwd();
    console.log("cwd: ", cwd);
    window.withProgress(
      {
        location: ProgressLocation.Window,
      },
      (progress) => {
        progress.report({ message: "Running `installSage` script" });

        return new Promise<void>((resolve) => {
          pretextOutputChannel.append(
            "Checking for new version of PreTeXt to install",
          );
          try {
            let runInstall = spawn("bash ./.devcontainer/installSage.sh", {
              cwd: cwd,
              shell: true,
            });
            runInstall.stdout.on("data", function (data: any) {
              console.log(`stdout: ${data}`);
              data = data.toString();
              pretextOutputChannel.appendLine(data);
            });
            runInstall.stderr.on("data", function (data: any) {
              console.log(`stderr: ${data}`);
              data = data.toString();
              pretextOutputChannel.appendLine(data);
            });
            runInstall.on("close", function (code: any) {
              console.log(`child process exited with code ${code}`);
              if (code !== 0) {
                pretextOutputChannel.appendLine(
                  `Error: child process exited with code ${code}`,
                );
                return;
              }
              pretextOutputChannel.appendLine(
                "Sage installation completed successfully.",
              );
            });
          } catch (e) {
            console.log("Unable to complete Sage install");
            console.log(e);
          }
          try {
            const devcontainerPath = `${cwd}/.devcontainer/devcontainer.json`;
            fs.readFile(devcontainerPath, "utf8", (err: any, data: string) => {
              if (err) {
                pretextOutputChannel.appendLine(
                  `Error reading devcontainer.json: ${err.message}`,
                );
                return;
              }
              pretextOutputChannel.appendLine(
                `Contents of devcontainer.json:\n${data}`,
              );
              const updatedData = data.replace(
                /\/\/\s*install sagemath:/i,
                "install sagemath:",
              );
              fs.writeFile(
                devcontainerPath,
                updatedData,
                "utf8",
                (err: any) => {
                  if (err) {
                    pretextOutputChannel.appendLine(
                      `Error writing to devcontainer.json: ${err.message}`,
                    );
                    return;
                  }
                  pretextOutputChannel.appendLine(
                    "Successfully updated devcontainer.json to uncomment 'install sage:'",
                  );
                },
              );
            });
          } catch (e) {
            console.log(
              "Unable to save SageMath install status to devcontainer.json",
            );
            console.log(e);
          }
          progress.report({ message: "Done" });
          resolve();
        });
      },
    );
  } else {
    window.showInformationMessage(
      "Sage installation is only supported in GitHub Codespaces.",
    );
  }
}
