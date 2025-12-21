/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import { ExtensionContext, TextEditor, workspace } from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

import { pretextOutputChannel } from "../ui";

let client: LanguageClient;

export function lspFormatDocument(editor: TextEditor) {
  if (editor) {
    client.sendRequest("workspace/executeCommand", {
      command: "formatDocument",
      arguments: [{ uri: editor.document.uri.toString() }],
    });
  } else {
    console.log("No active editor found to format document.");
  }
}

export async function lspFormatText(text: string): Promise<string> {
  const result = await client.sendRequest("workspace/executeCommand", {
    command: "formatText",
    arguments: [{ text: text }],
  });
  if (typeof result === "string") {
    return result;
  } else {
    throw new Error(
      "Expected string result from formatText, got: " + typeof result,
    );
  }
}

export function activate(context: ExtensionContext) {
  // The server is implemented in node
  const serverModule = context.asAbsolutePath(
    path.join("out", "lsp-server.js"),
  );
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [{ scheme: "file", language: "pretext" }],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher("**/project.ptx"),
    },
    //markdown: { isTrusted: true },
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    "pretextLanguageServer",
    "PreTeXt Language Server",
    serverOptions,
    clientOptions,
  );

  //context.subscriptions.push(
  //    vscode.commands.registerCommand("myExtension.sayHello", () => {
  //        vscode.window.showWarningMessage("Hello!");
  //    })
  //);

  // Start the client. This will also launch the server
  client.start();
  console.log("PreTeXt LSP Launched");
  pretextOutputChannel.appendLine("PreTeXt LSP Launched");
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
