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
 * Keep the import graph of this file free of `fs`, `child_process`, `./cli`,
 * `./utils`, `./ui`, `./pandoc` and `./cliPreviewServer`: one Node import
 * anywhere breaks the whole browser bundle. (`path` is fine — the web build
 * aliases it to path-browserify, and the paths this host sees are the virtual
 * ones of virtual-path.ts.)
 */
import { ExtensionContext, commands, languages, window } from "vscode";

import { pretextOutputChannel, setStatusBarReadyCommand } from "./ui-core";
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
import { registerProjectViews } from "./project-views";
import { cmdImport } from "./importWizardPanel";
import { cmdInsertFileAsDivision } from "./insert-import";
import {
  cmdInstantPreview,
  cmdInstantPreviewScope,
  cmdTogglePreviewSlidesView,
  disposeInstantPreview,
  previewTestHooks,
} from "./instantPreview";
import { browserPreviewHost } from "./preview-host-browser";

export async function activate(context: ExtensionContext) {
  pretextOutputChannel.appendLine(
    "Welcome to the pretext-tools extension (web). Building, previewing and other commands that need the PreTeXt CLI are available on desktop VS Code or in a Codespace.",
  );
  console.log('Extension "pretext-tools" (web) is now active!');

  // The status-bar item's idle click opens the command menu on the desktop;
  // there is no such menu here, so send it to the log.
  setStatusBarReadyCommand("pretext-tools.showLog");
  const previewHost = browserPreviewHost(context);

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
    // Import and insert convert in the webview / the import package. With no
    // pandoc on this host they read the formats the package converts itself
    // (LaTeX, Markdown, PreTeXt) and write through workspace.fs.
    commands.registerCommand("pretext-tools.importProject", () =>
      cmdImport(context),
    ),
    commands.registerCommand("pretext-tools.insertFileAsDivision", () =>
      cmdInsertFileAsDivision(),
    ),
    // The live preview renders in a Web Worker (Chromium-based browsers only:
    // the renderer needs WebAssembly JSPI); see preview-host-browser.ts.
    commands.registerCommand("pretext-tools.instantPreview", () =>
      cmdInstantPreview(previewHost),
    ),
    commands.registerCommand("pretext-tools.instantPreviewScope", () =>
      cmdInstantPreviewScope(previewHost),
    ),
    commands.registerCommand(
      "pretext-tools.togglePreviewSlidesView",
      cmdTogglePreviewSlidesView,
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

  // Outline and Targets views, reading the project through workspace.fs.
  const views = registerProjectViews(context);
  const exports = { ...views, preview: previewTestHooks };

  // Start the LSP in a Web Worker.
  try {
    lspActivate(context);
  } catch (error) {
    console.log("Error starting LSP client", error);
    pretextOutputChannel.appendLine(
      "Error starting language server.  Some features may not be available.",
    );
  }

  return exports;
}

export function deactivate() {
  disposeInstantPreview();
  return lspDeactivate();
}
