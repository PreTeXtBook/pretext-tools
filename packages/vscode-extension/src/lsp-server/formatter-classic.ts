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


//export function formatPTX(text: string): string {
//  // First clean up document so that each line is a single tag when appropriate.

//  let allText = joinLines(text);

//  console.log("Getting ready to start formatting.");
//  for (let btag of blockTags) {
//    if (allText.includes("<" + btag)) {
//      // start tag can be <tag>, <tag attr="val">, or <tag xmlns="..."> but shouldn't be self closing (no self closing tag would have xmlns in it)
//      let startTag = new RegExp(
//        "<" + btag + "(>|(\\s[^\\/]*?)>|(.*xmlns.*?)>)",
//        "g",
//      );
//      let endTag = new RegExp("<\\/" + btag + ">([\\s\\S]*?[.,!?;:]?)", "g");
//      allText = allText.replace(startTag, "\n$&\n");
//      allText = allText.replace(endTag, "\n$&\n");
//    }
//  }

//  for (let tag of lineEndTags) {
//    let startTag = new RegExp("<" + tag + "(.*?)>", "g");
//    let endTag = new RegExp("<\\/" + tag + ">([\\s\\S]*?[.,!?;:]?)", "g");
//    let selfCloseTag = new RegExp("<" + tag + "(.*?)\\/>", "g");
//    allText = allText.replace(startTag, "\n$&");
//    allText = allText.replace(endTag, "$&\n");
//    allText = allText.replace(selfCloseTag, "$&\n");
//  }

//  //const breakSentences = vscode.workspace
//  //  .getConfiguration("pretext-tools")
//  //  .get("formatter.breakSentences");
//  const breakSentences = globalSettings.formatter.breakSentences;
//  console.log("extraLineBreaks is ", breakSentences);

//  // Determine the number of spaces or tabs each indent is in current editor.
//  let editorTabSize = globalSettings.editor.tabSize;
//  console.log("editorTabSize is", editorTabSize);
//  let editorInsertSpaces = globalSettings.editor.insertSpaces;
//  console.log("editorInsertSpaces is", editorInsertSpaces);
//  // Set indent character to \t or a number of ss based on editor settings.
//  let indentChar = "\t";
//  if (editorInsertSpaces && typeof editorTabSize === "number") {
//    indentChar = " ".repeat(editorTabSize);
//  }

//  let level = 0;
//  let verbatim = false;
//  let lines = allText.split(/\r\n|\r|\n/g);
//  let fixedLines = [];
//  for (let line of lines) {
//    let trimmedLine = line.trim();
//    let openTagMatch = /^<(\w\S*?)(\s.*?|>)$/.exec(trimmedLine);
//    let closeTagMatch = /^<\/(\w\S*?)(\s.*?|>)(.?)$/.exec(trimmedLine);
//    // let selfCloseTagMatch = /^<(\w*?)(\s.*?\/>|\/>)$/.exec(trimmedLine);
//    if (trimmedLine.length === 0) {
//      continue;
//    } else if (trimmedLine.startsWith("<?")) {
//      // It's the start line of the file:
//      fixedLines.push(trimmedLine + "\n");
//    } else if (trimmedLine.startsWith("<!--")) {
//      // It's a comment:
//      fixedLines.push(indentChar.repeat(level) + trimmedLine);
//    } else if (closeTagMatch) {
//      if (blockTags.includes(closeTagMatch[1])) {
//        level = Math.max(0, level - 1);
//        fixedLines.push(indentChar.repeat(level) + trimmedLine);
//      } else if (verbatimTags.includes(closeTagMatch[1])) {
//        verbatim = false;
//        fixedLines.push(indentChar.repeat(level) + trimmedLine);
//      } else {
//        fixedLines.push(indentChar.repeat(level) + trimmedLine);
//      }
//    } else if (openTagMatch) {
//      fixedLines.push(indentChar.repeat(level) + trimmedLine);
//      if (blockTags.includes(openTagMatch[1])) {
//        level += 1;
//      } else if (verbatimTags.includes(openTagMatch[1])) {
//        verbatim = true;
//      }
//    } else if (verbatim) {
//      fixedLines.push(line);
//    } else {
//      if (breakSentences) {
//        trimmedLine = trimmedLine.replace(
//          /\.\s+/g,
//          ".\n" + indentChar.repeat(level),
//        );
//      }
//      fixedLines.push(indentChar.repeat(level) + trimmedLine);
//    }
//  }
//  // Second pass: add empty line between appropriate tags depending on blankLines setting.
//  //const blankLines = vscode.workspace
//  //  .getConfiguration("pretext-tools")
//  //  .get("formatter.blankLines");
//  type BlankLinesOption = "few" | "some" | "many";
//  const blankLines: BlankLinesOption = "some";
//  switch (blankLines) {
//    //case "few":
//    //  // do nothing
//    //  break;
//    case "some":
//      for (let i = 0; i < fixedLines.length - 1; i++) {
//        if (fixedLines[i].trim().startsWith("</")) {
//          for (let tag of newlineTags) {
//            let startTag = new RegExp("<" + tag + "(.*?)>", "g");
//            if (startTag.test(fixedLines[i + 1])) {
//              fixedLines[i] += "\n";
//            }
//          }
//        } else if (fixedLines[i].trim().startsWith("<title>")) {
//          fixedLines[i] += "\n";
//        }
//      }
//      break;
//    //case "many":
//    //  for (let i = 0; i < fixedLines.length - 1; i++) {
//    //    if (
//    //      fixedLines[i].trim().startsWith("</") ||
//    //      (fixedLines[i].trim().startsWith("<") &&
//    //        fixedLines[i + 1].trim().startsWith("<"))
//    //    ) {
//    //      fixedLines[i] += "\n";
//    //    }
//    //  }
//    //  break;
//  }

//  //// Add document identifier line if missing:
//  //if (!fixedLines[0].trim().startsWith("<?xml")) {
//  //  fixedLines.unshift('<?xml version="1.0" encoding="UTF-8" ?>\n');
//  //}

//  allText = fixedLines.join("\n");

//  return allText;
//}

export async function formatDocument(
  params: DocumentFormattingParams,
): Promise<TextEdit[] | null> {
  console.log("formatting document with PreTeXt's classic formatter.");
  const uri = params.textDocument.uri;
  const doc = documents.get(uri);
  console.log("formatting document", uri);
  console.log("doc is", doc);
  if (!doc) {
    return null;
  }
  const origText = doc.getText();
  const replacementRange: Range = {
    start: doc.positionAt(0),
    end: doc.positionAt(origText.length),
  };

  console.log("formatting with PreTeXt's classic formatter.");
  try {
    let formatted = formatPretext(origText);
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
  console.log("formatting with PreTeXt's classic formatter.");

  try {
    console.log("range is", range);
    const rangeSlice = origText.slice(
      doc.offsetAt(range.start),
      doc.offsetAt(range.end),
    );
    console.log(
      origText.slice(doc.offsetAt(range.start), doc.offsetAt(range.end)),
    );
    let formatted = formatPretext(rangeSlice);
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
  console.log("formatting with PreTeXt's classic formatter.");

  try {
    console.log(`formatting: ${origText}`);
    let formatted = formatPretext(origText);
    console.log("formatted", formatted);
    return formatted;
  } catch (e) {
    console.log("Could not format range", e);
  }
  return null;
}
