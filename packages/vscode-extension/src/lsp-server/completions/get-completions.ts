import {
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { documents, getDocumentInfo } from "../state";
import * as glob from "glob";
import * as path from "path";
import { URI } from "vscode-uri";
import {
  lineToPosition,
  rangeInLine,
  getCurrentTag,
  isPublicationPtx,
} from "./utils";
import { ATTRIBUTES, ELEMENTS, EXTRA_ELEMENT_SNIPPETS } from "./constants";
import {
  Position,
  Range,
  TextDocument,
} from "vscode-languageserver-textdocument";
import {
  references,
  pretextSchema,
  projectSchema,
  publicationSchema,
} from "../main";
import { isProjectPtx } from "../projectPtx/is-project-ptx";
import { Schema } from "../schema";
import { CompletionType } from "../../types";

const LINK_CONTENT_NODES = new Set(["xsl", "source", "publication"]);

const completionCache: CompletionItem[] = [];

async function getCompletionType(
  doc: TextDocument,
  pos: Position
): Promise<CompletionType> {
  // For now we assume that open tags are on the same line as the cursor.  TODO: fix this.
  const linePrefix = doc.getText(lineToPosition(pos));
  const match = linePrefix.match(/<[^>/]+$/);
  if (match) {
    // Check to see if the current position is inside a ref attribute.
    if (match[0].match(/<xref ref="[^"]*$/)) {
      return "ref";
      // Otherwise, see if we are in an attribute asking for a file.
    } else if (match[0].match(/(href|source)="[^"]*$/)) {
      return "file";
    } else {
      return "attribute";
    }
  }
  // Otherwise we default to assume we are in an element.
  return "element";
}

export async function getCompletions(
  params: TextDocumentPositionParams
): Promise<CompletionItem[] | null> {
  const uri = params.textDocument.uri;
  const info = getDocumentInfo(uri);
  const doc = documents.get(uri);
  const pos = params.position;
  if (!info || !doc) {
    console.warn("Requested project symbols for uninitialized file", uri);
    return null;
  }
  // Determine the type of completion to provide based on the current context.
  const completionType = await getCompletionType(doc, params.position);
  let completionItems: CompletionItem[] = [];
  if (completionType === "file") {
    // Get list of all possible files in **/source/** using fs and glob and return completions for them.
    // currentFileDir is the directory of the current file, in the current OS format.
    const currentFileDir = path.dirname(URI.parse(uri).fsPath);
    const files = glob.sync("source/**", { nodir: true });

    completionItems = [
      ...files.flatMap((f) => {
        // Get the relative path from the current file to the file f.
        let relPath = path.relative(currentFileDir, path.resolve(f));
        relPath = relPath.replaceAll(path.sep, path.posix.sep);
        // Allow completing both relative form starting with `./` and without.
        return [
          { label: relPath, kind: CompletionItemKind.File },
          { label: "./" + relPath, kind: CompletionItemKind.File },
        ];
      }),
    ];
  } else if (completionType === "ref") {
    for (let [reference, parent] of references) {
      const refCompletion: CompletionItem = {
        label: reference,
        kind: CompletionItemKind.Reference,
      };
      refCompletion.documentation = "(a " + parent + ")";
      refCompletion.detail = "(reference to " + parent + ")";
      refCompletion.sortText = "0" + reference;
      completionItems.push(refCompletion);
    }
  } else {
    // Completions for attributes and elements:
    // First, stop completions if the previous character (or the one before it in case a trigger character is used) is not a space, unless we are at the start of a line (in which case charsBefore will be empty).
    const charsBefore = doc.getText(rangeInLine(params.position, -2, 0));
    if (
      charsBefore.length !== 0 &&
      !charsBefore.includes(" ") &&
      !charsBefore.includes("\t")
    ) {
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
    // completions act slightly different for attributes and elements
    if (completionType === "attribute") {
      // get the current open tag as "element".
      const linePrefix = doc.getText(lineToPosition(params.position));
      const match = linePrefix.match(/<[^>/]+$/);
      if (!match) {
        return null;
      }
      const element = match[0].slice(1, match[0].indexOf(" "));
      // Build completions for attributes based on the current element.

      // Check if the element is in the list of known elements.
      if (
        !schema.elementChildren[element] ||
        !schema.elementChildren[element].attributes
      ) {
        return null;
      }
      // remove preceding trigger character if present:
      let range: Range;
      if (doc.getText(rangeInLine(pos, -1, 0)) === "@") {
        range = rangeInLine(pos, -1, 0);
      } else {
        range = rangeInLine(pos);
      }
      for (let attr of schema.elementChildren[element].attributes) {
        console.log("Found attribute", attr);
        if (attr in ATTRIBUTES) {
          const snippetCompletion = ATTRIBUTES[attr];
          snippetCompletion.insertText = snippetCompletion.insertText || attr;
          snippetCompletion.insertTextFormat = 2;
          snippetCompletion.textEdit = {
            newText: snippetCompletion.insertText,
            range: range,
          };
          snippetCompletion.kind = CompletionItemKind.TypeParameter;
          completionItems.push(snippetCompletion);
        } else {
          console.log("attr", attr);
          const snippetCompletion: CompletionItem = {
            label: "@" + attr,
            kind: CompletionItemKind.TypeParameter,
            insertTextFormat: 2,
            textEdit: {
              newText: `${attr}="$1"$0`,
              range: range,
            },
          };
          completionItems.push(snippetCompletion);
        }
      }
    } else if (completionType === "element") {
      const element = getCurrentTag(doc, pos);
      //console.log("currentTag", element);
      // Build completions for elements based on the current context.
      // Check if the element is in the list of known elements.
      if (
        !element ||
        !schema.elementChildren[element] ||
        !schema.elementChildren[element].elements
      ) {
        return null;
      }

      // remove preceding trigger character if present:
      let range: Range;
      if (doc.getText(rangeInLine(pos, -1, 0)) === "<") {
        range = rangeInLine(pos, -1, 0);
      } else {
        range = rangeInLine(pos);
      }
      for (let elem of schema.elementChildren[element].elements) {
        if (elem in ELEMENTS) {
          const snippetCompletion = ELEMENTS[elem];
          snippetCompletion.insertText = snippetCompletion.insertText || elem;
          snippetCompletion.insertTextFormat = 2;
          snippetCompletion.textEdit = {
            newText: snippetCompletion.insertText,
            range: range,
          };
          snippetCompletion.kind = CompletionItemKind.TypeParameter;
          snippetCompletion.sortText = snippetCompletion.sortText || elem;
          completionItems.push(snippetCompletion);
        } else {
          // Give a very basic snippet completion since we haven't implemented a more specific one in ELEMENTS.
          const snippetCompletion: CompletionItem = {
            label: "<" + elem,
            kind: CompletionItemKind.TypeParameter,
            insertTextFormat: 2,
            textEdit: {
              newText: `<${elem}>$1</${elem}>$0`,
              range: range,
            },
            documentation: "Generic implementation for element " + elem,
          };
          completionItems.push(snippetCompletion);
        }
      }
      // Also return the end tag for the current element.
      const snippetCompletion: CompletionItem = {
        label: "</" + element,
        kind: CompletionItemKind.TypeParameter,
        insertTextFormat: 2,
        textEdit: {
          newText: `</${element}>$0`,
          range: range,
        },
      };
      completionItems.push(snippetCompletion);
      // extend completionItems with extra completions:
      completionItems.push(...getExtraCompletions(element, range, schema));
    } else {
      return null;
    }
  }
  return completionItems.map((item, i) => {
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

function getExtraCompletions(
  element: string,
  range: Range,
  schema: Schema
): CompletionItem[] {
  let extraCompletions: CompletionItem[] = [];
  for (let [key, item] of Object.entries(EXTRA_ELEMENT_SNIPPETS)) {
    //Skip if the (parent) element is not in the list of acceptable parents.
    if (item.parents && !item.parents.includes(element)) {
      continue;
    }
    if (schema.elementChildren[element].elements.includes(item.alias)) {
      let snippetCompletion: CompletionItem = {
        label: item.label,
      };
      snippetCompletion.insertText = item.insertText;
      snippetCompletion.insertTextFormat = 2;
      snippetCompletion.textEdit = {
        newText: snippetCompletion.insertText,
        range: range,
      };
      snippetCompletion.documentation = item.documentation;
      snippetCompletion.kind = CompletionItemKind.TypeParameter;
      snippetCompletion.sortText = item.sortText;
      extraCompletions.push(snippetCompletion);
    }
  }
  return extraCompletions;
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
  item: CompletionItem
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
