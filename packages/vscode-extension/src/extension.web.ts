/**
 * Browser entry point (github.dev, vscode.dev).
 *
 * Declared as `"browser"` in package.json beside the Node `"main"`; VS Code
 * loads whichever matches the host. This activation registers only the pieces
 * that run without Node and without the `pretext` CLI; everything else is
 * hidden on the web by `when: "!isWeb"` clauses in the manifest. The language
 * server runs in a Web Worker (lsp-client/browser.ts). See
 * docs/web-extension-plan.md for what is here now and what is still to come.
 *
 * Keep the import graph of this file free of `fs`, `path`, `child_process`,
 * `./cli`, `./utils`, `./ui` and `./project`: one Node import anywhere breaks
 * the whole browser bundle.
 */
import { ExtensionContext, commands, languages, window } from "vscode";

import { pretextOutputChannel } from "./ui-core";
import { PretextActionsProvider } from "./actionsView";
import { cmdConvertText } from "./commands/convert";
import {
  cmdPasteAndConvert,
  pretextPasteEditProvider,
  pretextPasteProviderMetadata,
  PRETEXT_LANGUAGE_ID,
} from "./paste-convert";
import { lspFormatDocument } from "./lsp-client/shared";
import {
  activate as lspActivate,
  deactivate as lspDeactivate,
} from "./lsp-client/browser";
import { registerFlavorTakeover } from "./flavor-takeover";
import { registerTypingShortcuts } from "./typing-shortcuts";
import { registerSnippetSuggestions } from "./snippet-suggestions";
import { PretextVisualEditorProvider } from "./visualEditor";

export async function activate(context: ExtensionContext) {
  pretextOutputChannel.appendLine(
    "Welcome to the pretext-tools extension (web). Building, previewing and other commands that need the PreTeXt CLI are available on desktop VS Code or in a Codespace.",
  );
  console.log('Extension "pretext-tools" (web) is now active!');

  // Visual editor
  context.subscriptions.push(PretextVisualEditorProvider.register(context));

  // Opt-in takeover of .tex/.md files by the PreTeXt flavor languages.
  context.subscriptions.push(registerFlavorTakeover());

  // $x$ → <m>x</m>, escaping, double Enter / Shift+Enter paragraphs, theorem:.
  context.subscriptions.push(registerTypingShortcuts());

  // "PreTeXt › Snippet Suggestions" → `[pretext]` editor.snippetSuggestions.
  context.subscriptions.push(registerSnippetSuggestions());

  context.subscriptions.push(
    commands.registerCommand("pretext-tools.format", () => {
      const activeEditor = window.activeTextEditor;
      if (activeEditor) {
        return lspFormatDocument(activeEditor);
      } else {
        console.log("No document provided to format");
      }
    }),
    commands.registerCommand("pretext-tools.convertText", cmdConvertText),
    commands.registerCommand(
      "pretext-tools.pasteAndConvert",
      cmdPasteAndConvert,
    ),
    // Pasting LaTeX/Markdown into a PreTeXt file arrives converted (SPEC §9.5).
    languages.registerDocumentPasteEditProvider(
      { language: PRETEXT_LANGUAGE_ID },
      pretextPasteEditProvider,
      pretextPasteProviderMetadata,
    ),
    commands.registerCommand("pretext-tools.showLog", () =>
      pretextOutputChannel.show(),
    ),
    commands.registerCommand("pretext-tools.gettingStarted", () => {
      commands.executeCommand(
        "workbench.action.openWalkthrough",
        "oscarlevin.pretext-tools#gettingStarted",
      );
    }),
    window.registerTreeDataProvider(
      "pretextActions",
      new PretextActionsProvider({ web: true }),
    ),
  );

  // Start the LSP in a Web Worker.
  try {
    lspActivate(context);
  } catch (error) {
    console.log("Error starting LSP client", error);
    pretextOutputChannel.appendLine(
      "Error starting language server.  Some features may not be available.",
    );
  }
}

export function deactivate() {
  return lspDeactivate();
}
