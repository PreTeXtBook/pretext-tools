import { ProgressLocation, window } from "vscode";
import { pretextOutputChannel } from "../ui";
import * as utils from "../utils";

export async function cmdUpdate() {
  console.log("Updating PreTeXt");
  window.withProgress(
    {
      location: ProgressLocation.Window,
    },
    (progress) => {
      progress.report({ message: "Checking for updates" });

      return new Promise<void>((resolve) => {
        console.log("Checking for new version of PreTeXt to install");
        pretextOutputChannel.append(
          "Checking for new version of PreTeXt to install",
        );
        try {
          utils.installPretext(progress);
        } catch {
          console.log("Unable to update pretext");
        }
        progress.report({ message: "Done" });
        resolve();
      });
    },
  );
}
