import { execSync } from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";
import { SpellCheckScope } from "./types";
import { cli } from "./cli";
import {
  getProjectFolder,
  stripColorCodes,
  buildSpellCheckIgnorePatterns,
  upsertPretextLanguageSettings,
} from "./pure-utils";

export let currentPanel: vscode.WebviewPanel | undefined;

export {
  getProjectFolder,
  installPretext,
  setSchema,
  setSpellCheckConfig,
  cmdSpellCheck,
  updateStatusBarItem,
  setupTerminal,
  stripColorCodes,
  experiment,
};

async function experiment(context: vscode.ExtensionContext) {
  const columnToShowIn = vscode.window.activeTextEditor
    ? currentPanel && currentPanel.viewColumn
    : undefined;

  //// Get the URI for output/web/index.html in the user's first workspace
  //const workspaces = vscode.workspace.workspaceFolders;
  //if (!workspaces) {
  //  vscode.window.showErrorMessage(
  //    "No workspace found. Please open a workspace and try again."
  //  );
  //  return;
  //}
  //const workspace = workspaces[0];
  //const workspacePath = workspace.uri.fsPath;
  //const projectFolder = getProjectFolder(workspacePath);
  //if (!projectFolder) {
  //  vscode.window.showErrorMessage(
  //    "No project.ptx found in the workspace. Please open a PreTeXt project and try again."
  //  );
  //  return;
  //}
  //const outputPath = path.join(projectFolder, "output", "web", "sec-features-blocks.html");
  //console.log("Output path is: ", outputPath);
  //if (!fs.existsSync(outputPath)) {
  //  vscode.window.showErrorMessage(
  //    "No output/web/index.html found in the project. Please run a PreTeXt command to generate it."
  //  );
  //  return;
  //}
  //const outputUri = vscode.Uri.file(outputPath);
  //const panelSrc = currentPanel?.webview.asWebviewUri(outputUri);
  //console.log("Output URI is: ", outputUri);

  console.log("Current panel is: ", currentPanel);
  console.log("Current panel is visible? ", currentPanel?.visible);
  console.log("Current panel is active? ", currentPanel?.active);
  if (currentPanel) {
    // If we already have a panel, show it.
    currentPanel.reveal(columnToShowIn);
  } else {
    // Otherwise, create a new panel.
    currentPanel = vscode.window.createWebviewPanel(
      "boxEditor",
      "Box Editor",
      columnToShowIn || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    //const panelSrc = currentPanel?.webview.asWebviewUri(outputUri);
    // silly demo to show how to update the webview
    // every 5 seconds
    let iteration = 0;
    const updateWebview = () => {
      const color = iteration++ % 2 === 0 ? "red" : "blue";
      currentPanel!.title = `Box Editor - ${iteration}`;
      //currentPanel!.webview.html = getWebviewContent(color);
      console.log(`Webview updated to color: ${color}`);
      currentPanel!.webview.postMessage({ content: "hello" });
    };

    const scriptUri = currentPanel?.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "src", "views", "dist"),
    );
    currentPanel.webview.html = getWebviewContent(scriptUri);

    // Handle messages from the webview
    currentPanel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "alert":
            vscode.window.showErrorMessage(message.text);
            return;
        }
      },
      undefined,
      context.subscriptions,
    );

    const interval = setInterval(updateWebview, 5000);

    currentPanel.onDidDispose(
      () => {
        console.log("Webview closed");
        currentPanel = undefined;
        clearInterval(interval);
      },
      null,
      context.subscriptions || [],
    );
  }
}

function getWebviewContent(scriptUri: vscode.Uri): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Test webview</title>
    <script type="module" src="${scriptUri}/tiptap.js"></script>
  </head>
  <body>
  <h1>Test webview</h1>
    <div class="element"></div>
    <script>
      const vscode = acquireVsCodeApi();
      window.addEventListener('message', (event) => {
        const message = event.data;
        console.log("Message received: ", message);
        if (message) {
          const messageElement = document.createElement('p');
          messageElement.textContent = message.content;
          document.body.appendChild(messageElement);
        }
        vscode.postMessage({
          command: 'alert',
          text: 'Hello from the webview!'
        });
      });

    </script>
  </body>
</html>`;
}

async function installPretext(progress: vscode.Progress<{}>) {
  // Here we will attempt to pip install pretext, upgraded to the most recent version.  This will happen if pretext is not found, or if a user requests it through a command.

  // first check for python and pip:
  let pythonExec = cli.pythonPath();
  if (!pythonExec) {
    vscode.window.showErrorMessage(
      "Unable to install PreTeXt without python.  Please install python and try again.",
    );
    return;
  }
  progress.report({ message: "Checking pip version" });
  let pipExec = "";
  for (let command of ["pipx", "pip"]) {
    try {
      let pipVersion = execSync(
        pythonExec + " -m " + command + " --version",
      ).toString();
      console.log("pip version result: ", pipVersion);
      pipExec = command;
      break;
    } catch (err) {
      console.log("Error: ", err);
    }
  }
  // Now try to install pretext (using 1.0 command):
  progress.report({ message: "Installing pretext" });
  try {
    if (pipExec === "pipx") {
      execSync(pipExec + " install pretext");
    } else {
      execSync(pythonExec + " -m " + "pip" + " install --upgrade pretext");
      vscode.window.showInformationMessage(
        "Successfully installed or upgraded pretext.",
        "Dismiss",
      );
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      "Unable to install PreTeXt using pip.  Please see the pretext documentation for further assistance.",
      "Dismiss",
    );
    console.log(err);
    throw new Error("Installation failed");
  }
  progress.report({ message: "Done" });
}

/**
 * Get python command, either from settings or by verifying python3 or python is on PATH
 */

//const ptxVersion = getPtxVersion();

function setSpellCheckConfig() {
  const cSpellConfig = vscode.workspace.getConfiguration("cSpell");
  // Now update which scopes should be checked or ignored for spell checking.
  const spellCheckScopes: SpellCheckScope | undefined = vscode.workspace
    .getConfiguration("pretext-tools")
    .get("spellCheck.checkErrorsInsideScope");
  console.log(
    "Current value of spellCheck.checkErrorsInsideScope is",
    spellCheckScopes,
  );
  const ignorePatterns = buildSpellCheckIgnorePatterns(spellCheckScopes);
  // Merge the pretext ignore patterns into cSpell's languageSettings, creating
  // the pretext entry if cSpell doesn't already have one.
  const languageSettings = cSpellConfig.get("languageSettings");
  const updated = upsertPretextLanguageSettings(
    languageSettings,
    ignorePatterns,
  );
  console.log("Updated languageSettings for Pretext to", updated);
  cSpellConfig.update("languageSettings", updated);
}

/** Marketplace id of the Code Spell Checker extension we drive. */
const CSPELL_EXTENSION_ID = "streetsidesoftware.code-spell-checker";

/**
 * Command handler for `pretext-tools.spellCheck`.
 *
 * The actual checking is done by the Code Spell Checker extension; our job is to
 * make sure it is installed, teach it the PreTeXt-aware ignore patterns, enable
 * it for `.ptx` files, and surface the results in the Problems panel.
 */
async function cmdSpellCheck() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "pretext") {
    vscode.window.showWarningMessage(
      "Open a PreTeXt (.ptx) file to spell check it.",
    );
    return;
  }

  const cSpellExt = vscode.extensions.getExtension(CSPELL_EXTENSION_ID);
  if (!cSpellExt) {
    const choice = await vscode.window.showInformationMessage(
      "PreTeXt spell checking relies on the Code Spell Checker extension, which is not installed.",
      "Install",
      "Cancel",
    );
    if (choice === "Install") {
      await vscode.commands.executeCommand(
        "workbench.extensions.installExtension",
        CSPELL_EXTENSION_ID,
      );
    }
    return;
  }
  if (!cSpellExt.isActive) {
    await cSpellExt.activate();
  }

  // Make sure cSpell is enabled for pretext files, apply the PreTeXt-aware
  // ignore patterns, then reveal the results.
  const cSpellConfig = vscode.workspace.getConfiguration("cSpell");
  const enabledFileTypes: Record<string, boolean> =
    cSpellConfig.get("enabledFileTypes") ?? {};
  if (enabledFileTypes["pretext"] !== true) {
    await cSpellConfig.update("enabledFileTypes", {
      ...enabledFileTypes,
      pretext: true,
    });
  }
  try {
    setSpellCheckConfig();
  } catch (err) {
    console.log("Error setting spell check", err);
  }
  await vscode.commands.executeCommand("workbench.actions.view.problems");
}

function setSchema(context: vscode.ExtensionContext) {
  let schemaPath: string | undefined = vscode.workspace
    .getConfiguration("pretext-tools")
    .get("schema.customPath");
  let schemaVersion: string | undefined = vscode.workspace
    .getConfiguration("pretext-tools")
    .get("schema.versionName");
  if (schemaPath !== "" && schemaVersion !== "Custom") {
    console.warn(
      "Custom schema path provided, but version is not set to Custom.  Ignoring custom path.",
    );
  }
  if (!schemaPath || !fs.existsSync(schemaPath)) {
    console.error(`Schema file not found at path: ${schemaPath}`);
    schemaPath = "";
  }
  if (schemaPath === "") {
    //get the extensions installed path:
    const extensionPath = context.extensionPath;
    console.log("Extension path is: ", extensionPath);
    let schemaDir = path.join(extensionPath, "assets", "schema");
    console.log("Schema directory is: ", schemaDir);
    const schemaConfig = vscode.workspace
      .getConfiguration("pretext-tools")
      .get("schema.versionName");
    switch (schemaConfig) {
      case "Stable":
        schemaPath = path.join(schemaDir, "pretext.rng");
        break;
      case "Experimental":
        schemaPath = path.join(schemaDir, "pretext-dev.rng");
        break;
      case "Custom":
        console.log(
          "Selected custom schema, but no valid path provided.  Setting to default.",
        );
        schemaPath = path.join(schemaDir, "pretext.rng");
        break;
    }
  }
  const configuration = vscode.workspace.getConfiguration("xml");
  let schemas: any = configuration.get("fileAssociations");
  for (let dicts of schemas) {
    if (dicts["pattern"] === "**/source/**.ptx") {
      console.log("The value of your setting is", dicts);
      dicts["systemId"] = schemaPath;
      break;
    }
  }
  console.log("Schema set to: ", schemaPath);
  configuration.update("fileAssociations", schemas);
}

function updateStatusBarItem(
  ptxSBItem: vscode.StatusBarItem,
  state?: string,
): void {
  ptxSBItem.show();
  if (state === "ready" || state === undefined) {
    ptxSBItem.text = `$(debug-run) PreTeXt`;
    ptxSBItem.tooltip = `Run PreTeXt command`;
    ptxSBItem.command = `pretext-tools.selectPretextCommand`;
  } else if (state === "running") {
    ptxSBItem.text = `$(loading~spin) PreTeXt`;
    ptxSBItem.tooltip = `running pretext ... (click for log)`;
    ptxSBItem.command = `pretext-tools.showLog`;
  } else if (state === "success") {
    ptxSBItem.text = `$(pass) PreTeXt`;
    ptxSBItem.tooltip = `Success!`;
    ptxSBItem.command = `pretext-tools.selectPretextCommand`;
  } else if (state === "error") {
    ptxSBItem.text = `$(warning) PreTeXt`;
    ptxSBItem.tooltip = `Something went wrong; click for log`;
    ptxSBItem.command = `pretext-tools.showLog`;
  }
}

function setupTerminal(
  terminal: vscode.Terminal | null,
  projectPath?: string,
): vscode.Terminal {
  if (!terminal) {
    terminal = vscode.window.createTerminal("PreTeXt Terminal", projectPath);
  }
  terminal.show();
  return terminal;
}

/**
 * Generate a random nonce for use in webview content security policy.
 * @returns A random nonce string.
 */
export function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
