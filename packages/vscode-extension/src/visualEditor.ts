import * as vscode from "vscode";
import { getNonce } from "./utils";
import { formatPTX } from "./formatter";

// Based on the example at https://github.com/microsoft/vscode-extension-samples/tree/main/custom-editor-sample.

/**
 * Provider for PreTeXt visual editor.
 *
 * This provider demonstrates:
 *
 * - Setting up the initial webview for a custom editor.
 * - Loading scripts and styles in a custom editor.
 * - Synchronizing changes between a text document and a custom editor.
 */
export class PretextVisualEditorProvider
  implements vscode.CustomTextEditorProvider
{
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new PretextVisualEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      PretextVisualEditorProvider.viewType,
      provider,
    );
    return providerRegistration;
  }

  private static readonly viewType = "pretext.visualEditor";

  constructor(private readonly context: vscode.ExtensionContext) {
    console.log("PretextVisualEditorProvider constructor");
  }

  /**
   * Called when our custom editor is opened.
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    // Setup initial content for the webview
    webviewPanel.webview.options = {
      enableScripts: true,
    };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    function updateWebview() {
      console.log("updateWebview");
      // Send message to visual editor to update with the current text
      webviewPanel.webview.postMessage({
        type: "update",
        text: document.getText(),
      });
      return;
    }

    // TODO: this could be used for initial loading.
    function loadWebview() {
      console.log("loading webview");
      webviewPanel.webview.postMessage({
        type: "load",
        text: document.getText(),
      });
    }

    // Hook up event handlers so that we can synchronize the webview with the text document.
    //
    // The text document acts as our model, so we have to sync change in the document to our
    // editor and sync changes in the editor back to the document.
    //
    // Remember that a single text document can also be shared between multiple custom
    // editors (this happens for example when you split a custom editor)

    let timeout: NodeJS.Timeout | undefined;

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        // Only send updates if they come from an active text editor.
        const fromTextEditor = vscode.window.activeTextEditor !== undefined;
        // debounce the update to avoid sending too many messages
        // to the webview.  This is important because the webview
        // is not able to handle too many messages at once.
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
          if (
            e.document.uri.toString() === document.uri.toString() &&
            fromTextEditor
          ) {
            updateWebview();
            return;
          }
        }, 500);
      },
    );

    // Make sure we get rid of the listener when our editor is closed.
    webviewPanel.onDidDispose(() => {
      console.log("webviewPanel disposed");
      changeDocumentSubscription.dispose();
    });

    // Receive message *from* the webview.
    webviewPanel.webview.onDidReceiveMessage((e) => {
      console.log("Received message from visual editor", e);
      switch (e.type) {
        case "update":
          if (e.value === "") {
            console.error("Error getting text");
            return;
          }
          const edit = new vscode.WorkspaceEdit();
          const newText = formatPTX(e.value);
          edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            newText,
          );
          vscode.workspace.applyEdit(edit);
          return;
      }
    });

    webviewPanel.webview.onDidReceiveMessage((e) => {
      if (e.type === "ready") {
        loadWebview();
      }
    });

    //// Wait for the webview to signal that it is ready
    webviewPanel.webview.postMessage({ type: "checkReady" });
    //updateWebview()
  }

  /**
   * Get the static html used for the editor webviews.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    console.log("getHtmlForWebview");
    // Local path to script and css for the webview
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "out",
        "media",
        "visualEditor.js",
      ),
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "out",
        "media",
        "assets",
        "visualEditor.css",
      ),
    );

    // Use a nonce to whitelist which scripts can be run
    const nonce = getNonce();
    //TODO: Set up nonce to make this more secure.  Currently loading katex fonts doesn't work.
    return `<!doctype html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <title>Test webview</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet" />
            <script type="module" src="${scriptUri}"></script>
          </head>
          <body>
            <div id="root"></div>
          </body>
        </html>`;
  }
}
