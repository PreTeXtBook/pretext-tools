/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import { ExtensionContext } from "vscode";

import {
  LanguageClient,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

import { pretextOutputChannel } from "../ui-core";
import { clientOptions } from "./shared-options";
import { setClient } from "./shared";

export { lspFormatDocument, lspFormatText, lspProjectXmlIds } from "./shared";

let client: LanguageClient | undefined;

/**
 * Node host: the server runs as a forked Node process talking over IPC. The
 * browser host (`extension.web.ts`) will instead host the same server source
 * in a Web Worker — see docs/web-extension-plan.md, Phase 1.
 */
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

  // Create the language client and start the client.
  client = new LanguageClient(
    "pretextLanguageServer",
    "PreTeXt Language Server",
    serverOptions,
    clientOptions(),
  );
  setClient(client);

  // Start the client. This will also launch the server
  client.start();
  console.log("PreTeXt LSP Launched");
  pretextOutputChannel.appendLine("PreTeXt LSP Launched");
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  const stopping = client.stop();
  client = undefined;
  setClient(undefined);
  return stopping;
}
