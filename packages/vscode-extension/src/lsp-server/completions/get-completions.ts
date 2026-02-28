import {
  CompletionItem,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { documents, getDocumentInfo } from "../state";
import * as path from "path";
import { URI } from "vscode-uri";
import { isPublicationPtx } from "./utils";
import {
  references,
  pretextSchema,
  projectSchema,
  publicationSchema,
} from "../main";
import { isProjectPtx } from "../projectPtx/is-project-ptx";
import { Schema } from "../schema";
import { getPretextCompletions } from "@pretextbook/completions";

const completionCache: CompletionItem[] = [];

export async function getCompletions(
  params: TextDocumentPositionParams,
): Promise<CompletionItem[] | null> {
  const uri = params.textDocument.uri;
  const info = getDocumentInfo(uri);
  const doc = documents.get(uri);
  const pos = params.position;
  if (!info || !doc) {
    console.warn("Requested project symbols for uninitialized file", uri);
    return null;
  }
  // Set the schema based on the current file.
  let schema: Schema;
  if (isProjectPtx(uri)) {
    schema = projectSchema;
  } else if (isPublicationPtx(doc)) {
    schema = publicationSchema;
  } else {
    schema = pretextSchema;
  }

  const completionItems = await getPretextCompletions({
    text: doc.getText(),
    position: pos,
    schema,
    references,
    currentFileDir: path.dirname(URI.parse(uri).fsPath),
  });

  if (!completionItems || completionItems.length === 0) {
    return null;
  }

  return completionItems.map((item: CompletionItem, i: number) => {
    completionCache[i] = item;
    return {
      label: item.label,
      // insertText: item.insertText,
      textEdit: item.textEdit,
      // insertTextFormat: item.insertTextFormat,
      kind: item.kind,
      data: i,
    };
  });
}

/**
 * Provide completions for attributes in PreTeXt.  We check whether the cursor is inside an open tag, and if so, we provide completions for attributes.
 */
// export async function attributeCompletions(
//   params: TextDocumentPositionParams
// ): Promise<CompletionItem[] | null> {
//   const uri = params.textDocument.uri;
//   const info = getDocumentInfo(uri);
//   const doc = documents.get(uri);
//   if (!info || !doc) {
//     console.warn("Requested project symbols for uninitialized file", uri);
//     return null;
//   }
//   // First, stop completions if the previous character is not a space.
//   const charsBefore = doc.getText(rangeInLine(params.position, -2, 0)
//   );
//   if (!charsBefore.includes(" ") && !charsBefore.includes("\t")) {
//     return null;
//   }
//   // const attributeSnippets = JSON.parse(JSON.stringify(projectPtxAttributes));
//   // TODO: ensure that we are in an appropriate tag.  For now, return all attributes when in a tag.  Note that passing this element will not be necessary once we have a full AST.  That is not implemented in the function, so it does not have any effect yet.
//     const linePrefix = doc.getText(lineToPosition(params.position));
//     const match = linePrefix.match(/<[^>/]+$/);
//     if (!match) {
//       return null;
//     }
//     const element = match[0].slice(1, match[0].indexOf(" "));
//     console.log("element", element);
//   const attributeCompletionItems: CompletionItem[] =
//     // await getSnippetCompletionItems(
//     //   ATTRIBUTES,
//     //   CompletionItemKind.TypeParameter,
//     //   element,
//     //   params,
//     //   "@"
//     // );
//   // console.log("attributeCompletionItems", attributeCompletionItems);
//   return attributeCompletionItems.map((item,i) => {
//     completionCache[i] = item;
//     return {
//       label: item.label,
//       // insertText: item.insertText,
//       textEdit: item.textEdit,
//       // insertTextFormat: item.insertTextFormat,
//       kind: item.kind,
//       data: i,
//     };
//   });
// }

/**
 * Retrieve the full `item` details for the abbreviated completion item.
 */
export async function getCompletionDetails(
  item: CompletionItem,
): Promise<CompletionItem> {
  return completionCache[item.data];
}

// /**
//  *
//  * @param params
//  * @returns
//  */
// export async function getProjectPtxCompletionsX(
//   params: TextDocumentPositionParams
// ): Promise<CompletionItem[] | null> {
//   const uri = params.textDocument.uri;
//   const info = getDocumentInfo(uri);
//   const doc = documents.get(uri);
//   if (!info || !doc) {
//     console.warn("Requested project symbols for uninitialized file", uri);
//     return null;
//   }
//   // TODO: use the current or previously saved AST to determine the actual position and use that to determine what completions to use.
//   const targetAttributes = ["source", "xsl", "publication", "pubfile"];
//   const projectAttributes = ["source", "output", "output-dir"];
//   return [
//     {
//       label: "source",
//       kind: CompletionItemKind.Property,
//       data: 0,
//     },
//     {
//       label: "output",
//       kind: CompletionItemKind.Property,
//       data: 1,
//     },
//     {
//       label: "output-dir",
//       kind: CompletionItemKind.Property,
//       data: 2,
//     },
//   ];
// };

// if (containingElm.name === "project") {
//   // We're in the project tag. Return all the attributes that are allowed.
//   console.log("We're in the project tag");
//   return projectAttributes.map((attr,i) => {
//     return {
//       label: attr,
//       kind: CompletionItemKind.Property,
//       data: i,
//     };
//   });
// } else if (containingElm.name === "target") {
//   // We're in the target tag. Return all the attributes that are allowed.
//   console.log("We're in the target tag");
//   return targetAttributes.map((attr,i) => {
//     return {
//       label: attr,
//       kind: CompletionItemKind.Property,
//       data: i,
//     };
//   });
// } else {
//   console.log("No containing element");
//   return null;
// }

/**
 * Return all the linkable items in a project.ptx file.
 * NOTE, this is just a demo for now
 */
// export async function getProjectPtxCompletionsDemo(
//   params: TextDocumentPositionParams
// ): Promise<CompletionItem[] | null> {
//   const uri = params.textDocument.uri;
//   const info = getDocumentInfo(uri);
//   const doc = documents.get(uri);
//   if (!info || !doc) {
//     console.warn("Requested project symbols for uninitialized file", uri);
//     return null;
//   }
//   const ast = await info.ast;
//   // console.log("ast", ast);
//   if (!ast) {
//     // There could be no AST because the document was malformed, so this isn't neccessarily an error.
//     return null;
//   }
//   const offset = doc.offsetAt(params.position);
//   const containingElm = elementAtOffset(offset, ast);
//   console.log("containingElm", containingElm);
//   if (!containingElm || !LINK_CONTENT_NODES.has(containingElm.name)) {
//     return null;
//   }

//   // XXX: This is not right. We should only return completions when we're *inside*
//   // of the tag, but out of laziness we'll just return items whenever we're in the tag.
//   const pwd = new URL("./", uri).pathname;
//   const globQuery = new URL("./**/*(*.xml|*.ptx)", uri).pathname;
//   const files = glob.sync(globQuery, { nodir: true });
//   return files
//     .flatMap((f) => {
//       const relPath = f.slice(pwd.length);
//       // Allow completing both relative form starting with `./` and without.
//       return [
//         { relPath, path: f },
//         { relPath: "./" + relPath, path: f },
//       ];
//     })
//     .map((info, i) => {
//       // Store data about the file so we can show more information later (asyncronously)
//       completionCache[i] = info.path;
//       return {
//         label: info.relPath,
//         kind: CompletionItemKind.File,
//         data: i,
//       };
//     });
// }

// export async function getProjectPtxCompletionDetails(
//   item: CompletionItem
// ): Promise<CompletionItem> {
//   const fullPath = completionCache[item.data];
//   if (!fullPath) {
//     return item;
//   }
//   try {
//     const stats = fs.statSync(fullPath);
//     item.detail = `File is ${stats.size} bytes`;
//     item.documentation = "Reference this file in your project";
//   } catch (e) {
//     console.warn("Error when reading file", fullPath, e);
//   }
//   return item;
// }
