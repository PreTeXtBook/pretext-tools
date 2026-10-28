import {
  ExtensionContext,
  workspace,
  commands,
  languages,
  window,
} from "vscode";
import * as utils from "./utils";

import {
  pretextOutputChannel,
  pretextTerminal,
  ptxSBItem,
  showLog,
} from "./ui";
import {
  cmdView,
  cmdViewCLI,
  cmdViewVisualEditor,
  viewTarget,
} from "./commands/view";
import {
  cmdLivePreview,
  cmdForwardSearch,
  disposeLivePreview,
} from "./livePreview";
import {
  cmdInstantPreview,
  cmdInstantPreviewScope,
  cmdTogglePreviewSlidesView,
  disposeInstantPreview,
} from "./instantPreview";
import { PretextActionsProvider } from "./actionsView";
import { TargetNode } from "./targetsView";
import { registerProjectViews } from "./project-views";
import { cmdNew } from "./commands/new";
import { cmdDeploy } from "./commands/deploy";
import { cmdUpdate } from "./commands/update";
//import { ptxExperiment } from "./commands/experiment";
import { cmdExperimentConvert, cmdConvertText } from "./commands/convert";
import {
  cmdPasteAndConvert,
  pretextPasteEditProvider,
  pretextPasteProviderMetadata,
  PRETEXT_LANGUAGE_ID,
} from "./paste-convert";
import {
  buildTarget,
  cmdBuildAny,
  cmdBuildFile,
  cmdBuildLast,
  cmdGenerate,
} from "./commands/build";
import { cmdSelectCommand } from "./commands/select";
// Set up types:
import {
  activate as lspActivate,
  deactivate as lspDeactivate,
  lspFormatDocument,
  lspFormatText,
} from "./lsp-client/main";
import { addProjectProvider } from "./project";
import { systemDefaultProjects } from "./project-system-default";
import { desktopPandoc } from "./pandoc";
import { registerFlavorTakeover } from "./flavor-takeover";
import { registerTypingShortcuts } from "./typing-shortcuts";
import { registerSnippetSuggestions } from "./snippet-suggestions";
//import { cmdInstallSage } from "./commands/installSage";
import { PretextVisualEditorProvider } from "./visualEditor";
import { cmdImport } from "./importWizardPanel";
import { cmdInsertFileAsDivision } from "./insert-import";

// this method is called when your extension is activated
export async function activate(context: ExtensionContext) {
  pretextOutputChannel.appendLine("Welcome to the pretext-tools extension.");
  console.log('Extension "pretext-tools" is now active!');

  ///////////////// General Setup //////////////////////
  //_context = context;

  workspace.onDidChangeConfiguration((event) => {
    let affected = event.affectsConfiguration("pretext-tools");
    if (event.affectsConfiguration("pretext-tools.schema")) {
      console.log("PreTeXt Tools schema configuration changed");
      // Set schema for pretext files:
      try {
        utils.setSchema(context);
      } catch {
        console.log("Error setting schema");
      }
    }
    if (event.affectsConfiguration("pretext-tools.spellCheck")) {
      console.log("PreTeXt Tools spell check configuration changed");
      // Set spell check options:
      try {
        utils.setSpellCheckConfig();
      } catch {
        console.log("Error setting spell check");
      }
    }
  });

  // Set spell check options:
  try {
    utils.setSpellCheckConfig();
  } catch {
    console.log("Error setting spell check");
  }

  // Set schema for pretext files:
  // NB this is done for the XML extension for validation.  Also done in the LSP for completions.  Eventually this will all be in the LSP.
  try {
    utils.setSchema(context);
  } catch {
    console.log("Error setting schema");
  }

  context.subscriptions.push(ptxSBItem);
  utils.updateStatusBarItem(ptxSBItem);

  // Visual editor
  context.subscriptions.push(PretextVisualEditorProvider.register(context));

  // Opt-in takeover of .tex/.md files by the PreTeXt flavor languages.
  context.subscriptions.push(registerFlavorTakeover());

  // $x$ → <m>x</m>, escaping, double Enter / Shift+Enter paragraphs, theorem:.
  context.subscriptions.push(registerTypingShortcuts());

  // "PreTeXt › Snippet Suggestions" → `[pretext]` editor.snippetSuggestions.
  context.subscriptions.push(registerSnippetSuggestions());

  ///////////////// Commands //////////////////////

  // Import or define the client instance for LSP communication

  context.subscriptions.push(
    commands.registerCommand("pretext-tools.experiment", () => {
      console.log("Running PreTeXt experiment command");
      // Notify that no experiment command is currently available
      pretextOutputChannel.appendLine("No experiment command is implemented.");
      //cmdConvertMixedTextToPretextViaXast();
      //console.log("Experiment command executed.");
      //utils.experiment(context);
    }),
    commands.registerCommand(
      "pretext-tools.experimentConvert",
      cmdExperimentConvert,
    ),
    commands.registerCommand(
      "pretext-tools.selectPretextCommand",
      cmdSelectCommand,
    ),
    commands.registerCommand("pretext-tools.buildAny", cmdBuildAny),
    commands.registerCommand("pretext-tools.buildLast", cmdBuildLast),
    commands.registerCommand("pretext-tools.buildFile", cmdBuildFile),
    commands.registerCommand("pretext-tools.generate", cmdGenerate),
    commands.registerCommand("pretext-tools.view", cmdView),
    commands.registerCommand("pretext-tools.viewCLI", cmdViewCLI),
    commands.registerCommand(
      "pretext-tools.viewVisualEditor",
      cmdViewVisualEditor,
    ),
    commands.registerCommand("pretext-tools.livePreview", cmdLivePreview),
    commands.registerCommand("pretext-tools.instantPreview", () =>
      cmdInstantPreview(context.extensionPath),
    ),
    commands.registerCommand("pretext-tools.instantPreviewScope", () =>
      cmdInstantPreviewScope(context.extensionPath),
    ),
    commands.registerCommand(
      "pretext-tools.togglePreviewSlidesView",
      cmdTogglePreviewSlidesView,
    ),
    commands.registerCommand("pretext-tools.forwardSearch", cmdForwardSearch),
    commands.registerCommand("pretext-tools.new", cmdNew),
    commands.registerCommand("pretext-tools.importProject", () =>
      cmdImport(context, desktopPandoc),
    ),
    commands.registerCommand("pretext-tools.insertFileAsDivision", () =>
      cmdInsertFileAsDivision(desktopPandoc),
    ),
    commands.registerCommand("pretext-tools.deploy", cmdDeploy),
    commands.registerCommand("pretext-tools.updatePTX", cmdUpdate),
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
    commands.registerCommand("pretext-tools.spellCheck", utils.cmdSpellCheck),
    commands.registerCommand("pretext-tools.showLog", showLog),
    commands.registerCommand(
      "pretext-tools.buildTreeTarget",
      (node: TargetNode) => buildTarget(node.target),
    ),
    commands.registerCommand(
      "pretext-tools.viewTreeTarget",
      (node: TargetNode) => viewTarget(node.target),
    ),
    //commands.registerCommand("pretext-tools.installSage", cmdInstallSage),
    commands.registerCommand("pretext-tools.gettingStarted", () => {
      console.log("Opening getting started walkthrough");
      // Open the walkthrough
      commands.executeCommand(
        "workbench.action.openWalkthrough",
        "oscarlevin.pretext-tools#gettingStarted",
      );
    }),
  );

  // Register the actions tree view
  context.subscriptions.push(
    window.registerTreeDataProvider(
      "pretextActions",
      new PretextActionsProvider(),
    ),
  );

  // Outline and Targets views (shared with the browser entry point), with the
  // CLI's ~/.ptx templates added as a project of their own.
  addProjectProvider(systemDefaultProjects);
  const views = registerProjectViews(context);

  // Start the LSP
  try {
    lspActivate(context);
  } catch {
    console.log("Error starting LSP client");
    pretextOutputChannel.appendLine(
      "Error starting language server.  Some features may not be available.",
    );
  }

  pretextOutputChannel.appendLine(
    "PreTeXt related commands are available through the PreTeXt status bar menu or the command pallet (CTRL+SHIFT+P).",
  );

  return views;
}

// this method is called when your extension is deactivated
export function deactivate() {
  disposeLivePreview();
  disposeInstantPreview();
  lspDeactivate();
  if (pretextTerminal) {
    pretextTerminal.dispose();
  }
}
