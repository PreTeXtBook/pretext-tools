import { connection } from "./connection";
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
  InitializeResult,
  DocumentSymbol,
  CodeActionKind,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { isProjectPtx } from "./projectPtx/is-project-ptx";
import {
  clearAllDocumentInfo,
  clearDocumentInfo,
  documents,
  getDocumentInfo,
  initializeDocument,
  updateDocument,
} from "./state";
import { getProjectPtxSymbols } from "./projectPtx/get-symbols";
import { getProjectPtxLinks } from "./projectPtx/get-links";
import { getProjectPtxHoverInfo } from "./projectPtx/get-hover";
import {
  getCompletions,
  getCompletionDetails,
} from "./completions/get-completions";
//import { formatDocument, formatRange } from "./formatter";
import { formatDocument, formatRange, formatText } from "./formatter-ptx";
import { getReferences, updateReferences } from "./completions/utils";
import { getAst, initializeSchema, Schema } from "./schema";
import path from "path";

//Get path to schema:
export const schemaDir = path.join(__dirname, "..", "assets", "schema");

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
export let hasDiagnosticRelatedInformationCapability = false;

type LabelArray = [string, string, string][];
export let references: LabelArray = [];

export let pretextSchema: Schema;
export let projectSchema: Schema;
export let publicationSchema: Schema;

// vscode.workspace.onDidSaveTextDocument(async (document) => {
//   labels = await utils.updateReferences(document, labels);
// });

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ["@", "<", '"'],
      },
      // hoverProvider: { workDoneProgress: true },
      // documentSymbolProvider: { label: "PreTeXt Symbols" },
      // documentLinkProvider: {},
      // codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
      // executeCommandProvider: {
      //     commands: ["editor.action.addCommentLine"],
      // },
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
    },
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined,
    );
    //Set schema based on configuration:
    connection.workspace
      .getConfiguration(schemaConfigSection)
      .then(async (schemaConfig) => {
        if (schemaConfig) {
          pretextSchema = await initializeSchema(schemaConfig);
          globalSettings.schema = schemaConfig;
          console.log("Schema set to: ", schemaConfig);
          // Use the schemaConfig as needed
        } else {
          pretextSchema = await initializeSchema(globalSettings.schema);
          console.log("Schema set to: ", globalSettings.schema);
        }
      });
  } else {
    async () => {
      pretextSchema = await initializeSchema(globalSettings.schema);
      console.log("Schema set to: ", globalSettings.schema);
    };
  }

  publicationSchema = new Schema(
    getAst(path.join(schemaDir, "publication-schema.rng")),
  );
  projectSchema = new Schema(getAst(path.join(schemaDir, "project-ptx.rng")));

  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
    });
  }

  ///////////////// Completion Items //////////////////////
  references = [];
  try {
    references = getReferences();
  } catch {
    console.log("Error getting references");
  }
});

///////////////// Configuration //////////////////////

// The example settings
interface LspSettings {
  schema: {
    versionName: string;
    customPath: string;
  };
  formatter: {
    breakSentences: boolean;
    blankLines: "few" | "some" | "many";
  };
  editor: {
    tabSize: number;
    insertSpaces: boolean;
  };
}

const schemaConfigSection = "pretext-tools.schema";
const formatterConfigSection = "pretext-tools.formatter";
const editorConfigSection = "editor";
const tabSizeConfigSection = "editor.tabSize";
const insertSpacesConfigSection = "editor.insertSpaces";
// The global settings, used when the `workspace/configuration` request is not supported by the client.
const defaultSettings: LspSettings = {
  schema: { versionName: "Stable", customPath: "" },
  formatter: { blankLines: "some", breakSentences: true },
  editor: { tabSize: 2, insertSpaces: true },
};
export let globalSettings: LspSettings = defaultSettings;

connection.onDidChangeConfiguration((change) => {
  //clearAllDocumentInfo();
  console.log("changed configuration", change);
  if (hasConfigurationCapability) {
    connection.workspace
      .getConfiguration(formatterConfigSection)
      .then((formatterConfig) => {
        if (formatterConfig && globalSettings.formatter !== formatterConfig) {
          globalSettings.formatter = formatterConfig;
          console.log("Formatter set to", formatterConfig);
        }
      });
    connection.workspace
      .getConfiguration(editorConfigSection)
      .then((editorConfig) => {
        //console.log("editorConfig", editorConfig);
        //console.log("globalSettings.editor", globalSettings.editor);
        if (editorConfig && globalSettings.editor !== editorConfig) {
          console.log("Editor config changed to", editorConfig);
          globalSettings.editor = editorConfig;
        }
      });
    connection.workspace
      .getConfiguration(tabSizeConfigSection)
      .then((tabSizeConfig) => {
        if (tabSizeConfig && globalSettings.editor.tabSize !== tabSizeConfig) {
          console.log("Tab size changed to", tabSizeConfig);
          globalSettings.editor.tabSize = tabSizeConfig;
        }
      });
    connection.workspace
      .getConfiguration(insertSpacesConfigSection)
      .then((insertSpacesConfig) => {
        if (
          insertSpacesConfig &&
          globalSettings.editor.insertSpaces !== insertSpacesConfig
        ) {
          console.log("Insert spaces changed to", insertSpacesConfig);
          globalSettings.editor.insertSpaces = insertSpacesConfig;
        }
      });
    // Only update schema if that is the configuration that changed:
    connection.workspace
      .getConfiguration(schemaConfigSection)
      .then(async (schemaConfig) => {
        if (
          schemaConfig &&
          globalSettings.schema.versionName !== schemaConfig.versionName
        ) {
          pretextSchema = await initializeSchema(schemaConfig);
          globalSettings.schema = schemaConfig;
          console.log("Schema set to", schemaConfig);
        }
      });
  }

  ////Get the schema setting:
  //    if (change.settings && change.settings["pretext.schema"]) {
  //        console.log("schema setting changed to", change.settings["pretext.schema"]);
  //    }
  // Revalidate all open text documents
  for (const doc of documents.all()) {
    initializeDocument(doc.uri);
  }
});

// Only keep settings for open documents
documents.onDidClose((e) => {
  console.log("closed", e.document.uri);
  clearDocumentInfo(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(async (change) => {
  updateDocument(change.document);
  //console.log("changed content", change.document.uri);
  if (isProjectPtx(change.document)) {
    const info = await getDocumentInfo(change.document.uri);
    if (!info) {
      return;
    }
    await info.ast;
    const parseErrors = info.parseErrors;
    connection.sendDiagnostics({
      uri: change.document.uri,
      diagnostics: parseErrors,
    });
  }
});

documents.onDidSave((e) => {
  // update references for the saved document
  // TODO: this should just update references instead of finding all of them again.
  references = getReferences();
});

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  //connection.console.log("We received a file change event");
});

// This handler provides the initial list of the completion items.
connection.onCompletion(async (params) => {
  return getCompletions(params);
});

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(getCompletionDetails);

connection.onHover(async (params) => {
  if (isProjectPtx(params.textDocument.uri)) {
    connection.console.log("hovering over");
    return getProjectPtxHoverInfo(params);
  }
});

connection.onCodeAction((params) => {
  return [{ title: "My Custom Action" }];
});
connection.onExecuteCommand(async (params) => {
  // Handle commands sent from the client
  if (params.command === "formatText") {
    if (
      params.arguments &&
      params.arguments[0] &&
      typeof params.arguments[0].text === "string"
    ) {
      const newText = await formatText({ text: params.arguments[0].text });
      return newText;
    }
  } else if (params.command === "formatDocument") {
    if (
      params.arguments &&
      params.arguments[0] &&
      typeof params.arguments[0].uri === "string"
    ) {
      const uri = params.arguments[0].uri;
      const edits = await formatDocument({
        textDocument: { uri },
        options: {
          tabSize: globalSettings.editor.tabSize,
          insertSpaces: globalSettings.editor.insertSpaces,
        },
      });
      connection.sendRequest("workspace/applyEdit", {
        edit: { changes: { [uri]: edits } },
      });
    }
  }
});

connection.onNotification((...args) => {
  console.log("notified of", args);
});

connection.onDocumentLinks((params, cancel) => {
  if (isProjectPtx(params.textDocument.uri)) {
    return getProjectPtxLinks(params.textDocument.uri);
  }
});

connection.onDocumentSymbol(async (params): Promise<DocumentSymbol[]> => {
  if (isProjectPtx(params.textDocument.uri)) {
    return getProjectPtxSymbols(params.textDocument.uri);
  }
  return [];
});

connection.onDocumentFormatting(formatDocument);

connection.onDocumentRangeFormatting(formatRange);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
