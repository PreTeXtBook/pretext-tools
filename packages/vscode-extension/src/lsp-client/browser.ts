import { ExtensionContext, Uri } from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

import { pretextOutputChannel } from "../ui-core";
import { clientOptions } from "./shared-options";
import { registerProjectSync } from "./project-sync";
import { setClient } from "./shared";

// The browser extension host provides the Web Worker API; the extension's
// tsconfig targets Node, so declare the one constructor used here.
declare class Worker {
  constructor(scriptURL: string);
}

let client: LanguageClient | undefined;

/**
 * Browser host: the same language server source, bundled for the web
 * (`out/lsp-server.web.js`) and run in a Web Worker next to the extension.
 * The worker has no filesystem, so project files and schema assets reach it
 * through the client (see project-sync.ts).
 */
export function activate(context: ExtensionContext) {
  const serverMain = Uri.joinPath(
    context.extensionUri,
    "out",
    "lsp-server.web.js",
  );
  const worker = new Worker(serverMain.toString(true));

  client = new LanguageClient(
    "pretextLanguageServer",
    "PreTeXt Language Server",
    clientOptions(context),
    worker,
  );
  context.subscriptions.push(registerProjectSync(client));
  setClient(client);

  client.start();
  console.log("PreTeXt LSP (web worker) launched");
  pretextOutputChannel.appendLine("PreTeXt LSP (web worker) launched");
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
