//import {
//  DocumentFormattingParams,
//  DocumentRangeFormattingParams,
//  Range,
//  TextEdit,
//} from "vscode-languageserver/node";
//import * as prettier from "prettier";
//import { documents } from "./state";

//export async function formatWithPrettier(text: string, options: prettier.Options): Promise<string> {
//  const ret = prettier.format(text, {
//    parser: "ptx",
//    plugins: [prettierPluginPretext as unknown as prettier.Plugin],
//  });
//  console.log("The parser is", prettier.getSupportInfo().languages);
//  return ret;
//}

///**
// * Run the pretty printer on the document.
// */
//export async function formatDocument(
//  params: DocumentFormattingParams
//): Promise<TextEdit[] | null> {
//  const uri = params.textDocument.uri;
//  const doc = documents.get(uri);
//  if (!doc) {
//    return null;
//  }
//  const origText = doc.getText();
//  const replacementRange: Range = {
//    start: doc.positionAt(0),
//    end: doc.positionAt(origText.length),
//  };

//  console.log("formatting with Prettier.");
//  try {
//    let formatted = await formatWithPrettier(origText, {
//      tabWidth: params.options.tabSize,
//      useTabs: !params.options.insertSpaces,
//    });
//    if (
//      params.options.insertFinalNewline === false ||
//      params.options.trimFinalNewlines
//    ) {
//      formatted = formatted.trimEnd();
//    }
//    return [{ newText: formatted, range: replacementRange }];
//  } catch (e) {
//    console.log("Could not format document", e);
//  }

//  return null;
//}

//export async function formatRange(
//  params: DocumentRangeFormattingParams
//): Promise<TextEdit[] | null> {
//  const uri = params.textDocument.uri;
//  const doc = documents.get(uri);
//  if (!doc) {
//    return null;
//  }
//  const origText = doc.getText();
//  const range = params.range;
//  try {
//    console.log("range is", range);
//    console.log(
//      origText.slice(doc.offsetAt(range.start), doc.offsetAt(range.end))
//    );
//    let formatted = await formatWithPrettier(
//      origText.slice(doc.offsetAt(range.start), doc.offsetAt(range.end)),
//      {
//        tabWidth: params.options.tabSize,
//        useTabs: !params.options.insertSpaces,
//      }
//    );
//    console.log("formatting with Prettier.");
//    console.log("formatted", formatted);
//    return [{ newText: formatted, range }];
//  } catch (e) {
//    console.log("Could not format range", e);
//  }
//  return null;
//}
