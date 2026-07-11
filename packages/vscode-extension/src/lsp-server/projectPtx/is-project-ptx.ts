import { TextDocument } from "vscode-languageserver-textdocument";

/**
 * Determine whether a file is a `project.ptx` configuration file or not.
 */
export function isProjectPtx(textDocument: TextDocument | string): boolean {
  let uri = textDocument;
  if (typeof uri !== "string") {
    uri = uri.uri;
  }
  if (uri.endsWith("project.ptx")) {
    return true;
  }
  return false;
}
