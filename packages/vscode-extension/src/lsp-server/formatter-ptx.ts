//import * as vscode from "vscode";
import {
  DocumentFormattingParams,
  DocumentRangeFormattingParams,
  Range,
  TextEdit,
} from "vscode-languageserver/node";
import { documents } from "./state";
import { globalSettings } from "./main";
import { formatPretext } from "@pretextbook/format";

function getOptions() {
  const options = {
    breakSentences: globalSettings.formatter.breakSentences,
    blankLines: globalSettings.formatter.blankLines,
    indentSize: globalSettings.editor.tabSize,
    insertSpaces: globalSettings.editor.insertSpaces,
  };
  return options;
}

export async function formatDocument(
  params: DocumentFormattingParams,
): Promise<TextEdit[] | null> {
  const uri = params.textDocument.uri;
  const doc = documents.get(uri);
  if (!doc) {
    return null;
  }
  const origText = doc.getText();
  const replacementRange: Range = {
    start: doc.positionAt(0),
    end: doc.positionAt(origText.length),
  };

  console.log("formatting with pretext-tools formatter.");
  try {
    let formatted = formatPretext(origText, getOptions());
    return [{ newText: formatted, range: replacementRange }];
  } catch (e) {
    console.log("Could not format document", e);
  }

  return null;
}

export async function formatRange(
  params: DocumentRangeFormattingParams,
): Promise<TextEdit[] | null> {
  const uri = params.textDocument.uri;
  const doc = documents.get(uri);
  if (!doc) {
    return null;
  }
  const origText = doc.getText();
  const range = params.range;
  console.log("formatting with pretext-tools formatter.");

  try {
    console.log("range is", range);
    const rangeSlice = origText.slice(
      doc.offsetAt(range.start),
      doc.offsetAt(range.end),
    );
    console.log(
      origText.slice(doc.offsetAt(range.start), doc.offsetAt(range.end)),
    );
    let formatted = formatPretext(rangeSlice, getOptions());
    console.log("formatted", formatted);
    return [{ newText: formatted, range }];
  } catch (e) {
    console.log("Could not format range", e);
  }
  return null;
}

export async function formatText(params: {
  text: string;
}): Promise<string | null> {
  const origText = params.text;
  console.log("formatting with pretext-tools formatter.");

  try {
    console.log(`formatting: ${origText}`);
    let formatted = formatPretext(origText, getOptions());
    console.log("formatted", formatted);
    return formatted;
  } catch (e) {
    console.log("Could not format range", e);
  }
  return null;
}
