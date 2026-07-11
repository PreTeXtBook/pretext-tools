import { spawn } from "child_process";
import * as utils from "../utils";
import { commands, env, ProgressLocation, Uri, window } from "vscode";
import { ptxSBItem, pretextOutputChannel } from "../ui";
import { cli } from "../cli";

// The main function to run pretext commands:
export async function runPretext(
  ptxExec: string,
  ptxCommand: string,
  ptxOptions: string,
  projectPath: string = "",
): Promise<void> {
  return window.withProgress(
    {
      location: ProgressLocation.Window,
      title: "PreTeXt Command Running",
      cancellable: false,
    },
    async (progress) => {
      return new Promise<void>((resolve) => {
        utils.updateStatusBarItem(ptxSBItem, "running");
        var progressUpdate = "Starting up...";
        const interval = setInterval(
          () => progress.report({ message: progressUpdate }),
          1000,
        );
        let fullCommand = cli.cmd() + " " + ptxCommand + " " + ptxOptions;
        let status = "ready"; //for statusbaritem
        console.log("cwd = " + projectPath);

        let capturedOutput: string[] = [];
        let capturedErrors: string[] = [];
        pretextOutputChannel.clear();
        pretextOutputChannel.appendLine(
          "\n\nNow running `" + fullCommand + "`...",
        );
        progressUpdate = "Running " + fullCommand;
        var ptxRun = spawn(fullCommand, [], {
          cwd: projectPath,
          shell: true,
        });
        ptxRun.stdout.on("data", function (data) {
          console.log(`stdout: ${data}`);
          data = utils.stripColorCodes(data.toString());
          // save important messages to capturedOutput and add to output channel
          if (
            data
              .toString()
              .includes(
                "Your built project will soon be available to the public at:",
              )
          ) {
            capturedOutput.push(data);
            console.log("found the url: ", capturedOutput);
          }
          // we treat the view command differently and add a special message to the output channel
          if (
            data.toString().startsWith("Server will soon be available at") ||
            data.toString().includes("[Ctrl]+[C]")
          ) {
            pretextOutputChannel.appendLine(`${data}`);
            pretextOutputChannel.append(
              "(this local server will remain running until you close vs-code)\n",
            );
            capturedOutput.push(data);
            console.log("Using view. Status should change back");
            utils.updateStatusBarItem(ptxSBItem, "success");
            resolve();
            clearInterval(interval);
          } else {
            pretextOutputChannel.append(`${data}`);
          }
        });
        ptxRun.stderr.on("data", function (data) {
          console.log(`stderr: ${data}`);
          data = utils.stripColorCodes(data.toString());
          capturedErrors.push(data);
        });

        ptxRun.on("close", function (code) {
          console.log(code);
          if (ptxRun.killed) {
            pretextOutputChannel.appendLine(
              "...PreTeXt command terminated early.",
            );
            console.log("Process killed");
          } else {
            pretextOutputChannel.appendLine("...PreTeXt command finished.");
          }
          if (code === 1) {
            console.log("PreTeXt encountered an error; code =", code);
            for (let error of capturedErrors) {
              pretextOutputChannel.appendLine("Collected Errors:\n");
              pretextOutputChannel.appendLine(error);
            }
            window
              .showErrorMessage(
                "PreTeXt encountered one or more errors",
                "Show Log",
                "Dismiss",
              )
              .then((option) => {
                if (option === "Show Log") {
                  pretextOutputChannel.show();
                }
              });
          } else {
            console.log("PreTeXt command finished successfully; code =", code);
            if (ptxCommand === "build") {
              window
                .showInformationMessage(
                  "Build successful! You can preview your output now.",
                  "Dismiss",
                  "View log",
                )
                .then((option) => {
                  if (option === "View log") {
                    pretextOutputChannel.show();
                  }
                });
            } else if (ptxCommand === "deploy") {
              if (capturedOutput.length > 0) {
                // get last line of data which is the url
                const siteURL = Uri.parse(
                  capturedOutput
                    .splice(-1)[0]
                    .split("soon be available to the public at:")
                    .slice(-1)[0]
                    .trim(),
                );
                console.log("Opening site at: ", siteURL);
                window
                  .showInformationMessage(
                    "Deploy successful! You can view your deployed site now.",
                    "Visit site",
                    "View log",
                    "Dismiss",
                  )
                  .then((option) => {
                    if (option === "Visit site") {
                      // get last line of data which is the url
                      console.log("Opening site at: ", siteURL);
                      env.openExternal(siteURL);
                    } else if (option === "View log") {
                      pretextOutputChannel.show();
                    }
                  });
              } else {
                pretextOutputChannel.show();
              }
            }
          }
          utils.updateStatusBarItem(ptxSBItem, status);
          progressUpdate = "Finished";
          resolve();
          clearInterval(interval);
        });
      });
    },
  );
}

export async function runThenOpen(
  ptxExec: string,
  ptxCommand: string,
  ptxOptions: string,
  folderUri: Uri,
) {
  try {
    await runPretext(ptxExec, ptxCommand, ptxOptions, folderUri.fsPath);
    window.showInformationMessage("PreTeXt command completed successfully!");
  } catch (error) {
    console.error("Error running PreTeXt command: ", error);
    window.showErrorMessage("Error running PreTeXt command: " + error);
  }
  await commands.executeCommand("vscode.openFolder", folderUri);
  console.log("Opening folder: ", folderUri.fsPath);
}
