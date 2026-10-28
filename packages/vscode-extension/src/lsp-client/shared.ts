import { Range, TextEditor, workspace } from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";
import { formatPretext } from "@pretextbook/format";

import { pretextOutputChannel } from "../ui-core";

/**
 * Host-independent half of the LSP client: the requests the rest of the
 * extension sends to the language server. The Node entry (`main.ts`) and the
 * browser entry create the actual `LanguageClient` (process vs. Web Worker)
 * and hand it over through {@link setClient}.
 */

let client: BaseLanguageClient | undefined;

export function setClient(newClient: BaseLanguageClient | undefined) {
  client = newClient;
}

export function getClient(): BaseLanguageClient | undefined {
  return client;
}

export function lspFormatDocument(editor: TextEditor) {
  if (!client) {
    return formatEditorInProcess(editor);
  }
  if (editor) {
    client.sendRequest("workspace/executeCommand", {
      command: "formatDocument",
      arguments: [{ uri: editor.document.uri.toString() }],
    });
  } else {
    console.log("No active editor found to format document.");
  }
}

/**
 * Format a PreTeXt fragment with the user's formatter settings. Goes through
 * the language server when it is running; otherwise (the browser host before
 * its worker-hosted server exists, or a server that failed to start) formats
 * in-process with the same library the server uses, so conversion commands
 * keep working.
 */
export async function lspFormatText(text: string): Promise<string> {
  if (!client) {
    return formatInProcess(text);
  }
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

/** Whole-document counterpart of {@link formatInProcess}, applied as one edit. */
async function formatEditorInProcess(editor: TextEditor): Promise<void> {
  const document = editor.document;
  const formatted = formatInProcess(document.getText());
  const whole = new Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  await editor.edit((edit) => edit.replace(whole, formatted));
}

/** Format `text` in-process with the user's formatter settings (see {@link lspFormatText}). */
export function formatInProcess(text: string): string {
  const formatter = workspace.getConfiguration("pretext-tools.formatter");
  const editor = workspace.getConfiguration("editor");
  return formatPretext(text, {
    breakSentences: formatter.get<boolean>("breakSentences", true),
    breakLines: formatter.get<"few" | "some" | "many">("blankLines", "some"),
    breakLongAttributes: formatter.get<boolean>("breakLongAttributes", false),
    tabSize: editor.get<number>("tabSize", 2),
    insertSpaces: editor.get<boolean>("insertSpaces", true),
    printWidth: formatter.get<number>("printWidth", 80),
  });
}

/**
 * Every `xml:id` the project currently uses, walked from its main source
 * through every `xi:include`. An import inserting into the project needs these
 * so it can rename anything that would collide (packages/import/SPEC.md §9.3).
 *
 * Returns an empty list when the server is not running or answers with
 * something unexpected: a missing id list makes the import rename nothing,
 * which is the same risk the author already runs when pasting by hand.
 */
export async function lspProjectXmlIds(): Promise<string[]> {
  if (!client) {
    return [];
  }
  try {
    const result = await client.sendRequest("workspace/executeCommand", {
      command: "projectXmlIds",
      arguments: [],
    });
    return Array.isArray(result)
      ? result.filter((id): id is string => typeof id === "string")
      : [];
  } catch (error) {
    pretextOutputChannel.appendLine(
      `Could not read project xml:ids from the language server: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}
