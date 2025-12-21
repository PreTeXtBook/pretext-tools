import { Diagnostic, TextDocuments } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Root, Node } from "xast";
import { connection } from "./connection";
import { validateXml } from "../parse/validate-xml";
import { fromXml } from "xast-util-from-xml";

type DocumentInfo = {
  validXml: boolean;
  ast: Thenable<Node | null> | Root | null;
  settings: Thenable<LspSettings>;
  parseErrors: Diagnostic[];
  _dirty: boolean;
};

type LspSettings = { maxReportableProblems: number };

const DEFAULT_DOCUMENT_SETTINGS: LspSettings = {
  maxReportableProblems: 1000,
} as const;
const DEFAULT_DOCUMENT_INFO: DocumentInfo = {
  validXml: false,
  ast: null,
  settings: Promise.resolve({ ...DEFAULT_DOCUMENT_SETTINGS }),
  parseErrors: [],
  _dirty: true,
};

function getDefaultInfo(): DocumentInfo {
  return {
    ...DEFAULT_DOCUMENT_INFO,
    settings: Promise.resolve({ ...DEFAULT_DOCUMENT_SETTINGS }),
    parseErrors: [],
  };
}

/**
 * This caches data on all documents so that we don't recompute unnecessarily!
 */
export const documentInfoCache: Map<string, DocumentInfo> = new Map();

/**
 * Remove the document from the cache.
 */
export function clearDocumentInfo(uri: string) {
  documentInfoCache.delete(uri);
}

/**
 * Clears information about all documents in the cache.
 */
export function clearAllDocumentInfo() {
  documentInfoCache.clear();
}

/**
 * Add the document to the cache and initialize its settings.
 */
export function initializeDocument(uri: string) {
  const info = getDefaultInfo();
  info.settings = getDocumentSettings(uri);
  documentInfoCache.set(uri, info);
  return info;
}

export function updateDocument(document: TextDocument) {
  let info = getDocumentInfo(document.uri);
  if (!info) {
    info = initializeDocument(document.uri);
  }
  info._dirty = true;
  info.ast = (async () => {
    if (info._dirty === false) {
      return await info.ast;
    }
    const source = document.getText();
    info.parseErrors = await validateXml(source);
    if (info.parseErrors.length === 0) {
      // No parse errors, so parse the whole tree!
      info._dirty = false;
      return fromXml(source);
    }

    info._dirty = false;
    // If we're here, there were parse errors, so we return a null AST
    return null;
  })();
}

/**
 * Get information about a document, but only if `initializeDocument` has been called prior.
 */
export function getDocumentInfo(uri: string): DocumentInfo | undefined {
  return documentInfoCache.get(uri);
}

/**
 * Retrieve the documents settings from vscode.
 */
function getDocumentSettings(uri: string) {
  const cached = documentInfoCache.get(uri);
  if (cached) {
    return cached.settings;
  }
  return (async () => {
    const settings: LspSettings = await connection.workspace.getConfiguration({
      scopeUri: uri,
      section: "pretextLanguageServer",
    });
    return settings || { ...DEFAULT_DOCUMENT_SETTINGS };
  })();
}

/**
 * Document manager; this handles callbacks from the LSP and keeps in sync with vscode
 */
export const documents: TextDocuments<TextDocument> = new TextDocuments(
  TextDocument,
);
