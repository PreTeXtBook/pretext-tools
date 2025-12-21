import * as fs from "fs";
import { Snippets } from "../../types";
import { elementChildren } from "../../constants";
import {
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  InsertTextFormat,
  Range,
  Position,
} from "vscode-languageserver/node";
import { documents } from "../state";
import { TextDocument } from "vscode-languageserver-textdocument";
import path from "path";

export async function readJsonFile(relativePath: string): Promise<any> {
  try {
    // Set the absolute path to the snippets file:
    const data = fs.readFileSync(relativePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading file from disk: ${error}`);
    return null;
  }
}

/**
 * Returns a position in the same line shifted by a given number of characters.  If a the number of characters would shift the position beyond the end of the line, or before the start of the line, the end or start of the line position is returned.
 * @param position - the starting position
 * @param shift - the number of characters to shift.  Negative shifts move the position to the left. Defaults to 0.
 * @returns the new position
 */
function positionCharShift(position: Position, shift?: number): Position {
  return {
    line: position.line,
    character: position.character + (shift || 0),
  };
}

/**
 * Returns a range contained on the current line, starting prior to a given position by a given shift and ending at the given position after a second given shift.
 * @param position - the position to shift
 * @param startShift - the shift to apply
 * @param endShift - the shift to apply
 * @returns the new range
 */
export function rangeInLine(
  position: Position,
  startShift?: number,
  endShift?: number,
): Range {
  return {
    start: positionCharShift(position, startShift),
    end: positionCharShift(position, endShift),
  };
}

/**
 * Returns a range from the start of the line to a given position.
 * @param position - the position to end the range
 * @returns the new range
 */
export function lineToPosition(position: Position): Range {
  return {
    start: { line: position.line, character: 0 },
    end: position,
  };
}

/**
  Finds the current node of the curser by comparing all tags above the curser to the open tags above the curser.
 */
export function getCurrentTag(
  document: TextDocument,
  position: Position,
): string | undefined {
  const textUntilPosition = document?.getText({
    start: { line: 0, character: 0 },
    end: position,
  });
  // Get all open and close tags from the text until the current position.
  const allTags = (
    textUntilPosition?.match(/<(\w)+(?![^>]*\/>)|<\/\w+/g) || []
  ).map((tag) => tag.slice(1));
  const openedTags = (
    textUntilPosition?.match(/<(\w)+(?![^>]*\/>)/g) || []
  ).map((tag) => tag.slice(1));
  const closedTags = (textUntilPosition?.match(/<\/\w+/g) || []).map((tag) =>
    tag.slice(2),
  );

  // Now walk through list of all tags, creating a stack of open tags and removing closed tags from the stack.
  let openTagStack: string[] = [];
  for (let tag of allTags) {
    if (tag.startsWith("/")) {
      const lastOpenTag = openTagStack.pop();
      if (lastOpenTag !== tag.slice(1)) {
        console.error(
          `Error: Found closing tag ${tag} without matching opening tag.`,
        );
      }
    } else {
      openTagStack.push(tag);
    }
  }

  const currentTag = openTagStack.pop();
  console.log("Current XML Element: ", currentTag);
  return currentTag;
}

/**
 * Reads a snippet file and returns a list of completion items.
 * @param snippets - the snippets to read
 * @param kind - the kind of completion item
 * @param node - the current (open) node/element
 * @param document - the current document
 * @param position - the current position of the cursor
 */
export async function getSnippetCompletionItems(
  snippets: Snippets,
  kind: CompletionItemKind | undefined,
  node: string | undefined,
  params: TextDocumentPositionParams,
  trigger: string,
): Promise<CompletionItem[]> {
  const uri = params.textDocument.uri;
  const position = params.position;
  const document = documents.get(uri);
  const labels = ["source", "xsl", "publication", "pubfile"];
  let completionItems: CompletionItem[] = [];
  for (let elem of labels) {
    console.log(elem);
    if (elem in snippets) {
      console.log("found");
      const snippetCompletion: CompletionItem = {
        label: snippets[elem].prefix,
        kind: kind,
      };
      console.log(snippets[elem]);
    }
  }
  for (let [key, value] of Object.entries(snippets)) {
    if (node) {
      if (trigger === "@") {
        if (
          node in elementChildren &&
          !elementChildren[node].attributes.includes(key.split(" ")[0])
        ) {
          continue;
        }
      } else if (trigger === "<") {
        if (
          node in elementChildren &&
          !elementChildren[node].elements.includes(key.split(" ")[0])
        ) {
          continue;
        }
      }
    }
    const snippetCompletion: CompletionItem = {
      label: value.prefix,
      kind: kind,
    };
    // remove preceding trigger character if present:
    let range: Range;
    if (
      document &&
      document.getText(rangeInLine(position, -1, 0)) === trigger
    ) {
      console.log("trigger detected");
      range = rangeInLine(position, -1, 0);
    } else {
      range = rangeInLine(position);
    }

    // TODO: check whether this should just be the label when the editor doesn't support snippets.
    snippetCompletion.insertText = value.body;
    snippetCompletion.insertTextFormat = InsertTextFormat.Snippet;
    snippetCompletion.detail = value.description; //should be more api-like
    snippetCompletion.documentation = value.description; //plain language description
    snippetCompletion.sortText = value.sort ? value.sort + key : key;
    snippetCompletion.filterText = value.prefix;
    snippetCompletion.textEdit = { newText: value.body, range: range };
    if (value.retrigger) {
      snippetCompletion.command = {
        title: "Suggest",
        command: "editor.action.triggerSuggest",
      };
    }
    // condition on the label existing to avoid "default" completion.
    if (snippetCompletion.label) {
      completionItems.push(snippetCompletion);
    }
  }
  // Also add a closing tag for the current node, since we have turned off this feature from redhat.vscode-xml.
  if (node && trigger === "<") {
    const closeTagCompletion: CompletionItem = {
      label: `/${node}>`,
      kind: kind,
    };
    closeTagCompletion.insertText = `/${node}>`;
    closeTagCompletion.documentation = `Close the ${node} tag`;
    closeTagCompletion.detail = `Close the ${node} tag`;
    completionItems.push(closeTagCompletion);
  }
  return completionItems;
}

function getMainFile() {
  const pwd = "./";
  // Default source directory is ./source
  let sourceDir = path.join(pwd, "source");
  // Set default main file to main.ptx
  let mainFile = path.join(sourceDir, "main.ptx");
  // Check if project.ptx exists and if so, use that to find main file
  let project = path.join(pwd, "project.ptx");
  if (fs.existsSync(project)) {
    console.log("Found project.ptx");
    const text = fs.readFileSync(project).toString();
    // Determine whether v1 or v2:
    let regexVersion = /<project\s(.*?)ptx-version="2"/;
    if (regexVersion.test(text)) {
      console.log("project.ptx is version 2");
      let regexProject = /<project\s(.*?)source="(.*?)"/;
      let regexTarget = /<target\s(.*?)source="(.*?)"/;
      let projectSourceMatch = regexProject.exec(text);
      let targetSourceMatch = regexTarget.exec(text);
      if (projectSourceMatch) {
        sourceDir = path.join(pwd, projectSourceMatch[2]);
        if (targetSourceMatch) {
          mainFile = path.join(sourceDir, targetSourceMatch[2]);
        } else {
          mainFile = path.join(sourceDir, "main.ptx"); // default
        }
      } else if (targetSourceMatch) {
        // No project source, so use default set above.
        mainFile = path.join(sourceDir, targetSourceMatch[2]);
      }
    } else {
      console.log("project.ptx is legacy version");
      let regexTarget = /<source>(.*?)<\/source>/;
      let targetSourceMatch = regexTarget.exec(text);
      if (targetSourceMatch) {
        mainFile = path.join(pwd, targetSourceMatch[1]);
      }
    }
  }
  console.log("Checking for main source file: ", mainFile);
  if (fs.existsSync(mainFile)) {
    console.log("Found main source file", mainFile);
    return mainFile;
  } else {
    console.log("main source file not found");
    return "";
  }
}

// define a type for the array of labels:
type LabelArray = [string, string, string][];

/**
 * Search through a project to find all xml:id's.  Start with main.ptx and include any fine that is xi:included up to a depth of 5.
 */
export function getReferences(): LabelArray {
  // Look through all files in project directory and collect all labels contained as xml:id attributes.
  let baseFile = getMainFile();
  let references: LabelArray = [];
  let files = [baseFile];
  let depth = 0;
  // const uri = vscode.Uri.file(sourceDir);
  // let files = await vscode.workspace.fs.readDirectory(uri);
  while (depth < 5 && files.length > 0) {
    let newFiles: string[] = [];
    for (const file of files) {
      if (fs.existsSync(file)) {
        let text = fs.readFileSync(file).toString();
        let regex = /<xi:include\s+href="([^"]+)"/g;
        let matches = [...text.matchAll(regex)];
        newFiles = newFiles.concat(
          matches.map((match) => path.join(file, "..", match[1])),
        );
        regex = /<(\w*?)\s(.*?)xml:id="([^"]+?)"/g;
        matches = [...text.matchAll(regex)];
        const posixFile = file.replace(/\\/g, "/");
        references = references.concat(
          matches.map((match) => [match[3], match[1], posixFile]),
        );
      }
    }
    files = newFiles;
    depth++;
  }
  console.log("Finished collecting references, reached depth of ", depth);
  return references;
}

export function updateReferences(
  document: TextDocument,
  references: LabelArray = [],
) {
  console.log("Updating references");
  // Look through the specified file collect all labels contained as xml:id attributes.
  // This can then be used to update the current list of references every time a file is saved.
  let fileContents = document.getText();
  let regex = /<(\w*?)\s(.*?)xml:id="([^"]+)"/g;
  let matches = [...fileContents.matchAll(regex)];
  const rootDir = fs.realpathSync(".");
  console.log("Root directory: ", rootDir);
  const currentFile = document.uri;
  console.log("Current file: ", currentFile);
  const posixFile = path.posix.relative(rootDir, currentFile);
  console.log("Current file: ", posixFile);
  // Remove all (old) labels from the current file:
  references = references.filter((label) => label[2] !== posixFile);
  // Add all (new) labels from the current file:
  references = references.concat(
    matches.map((match) => [match[3], match[1], posixFile]),
  );
  console.log("Done updating labels");
  return references;
}

export function isPublicationPtx(document: TextDocument): boolean {
  // Look for a starting tag of <publication> in the file.
  let fileContents = document.getText();
  let regex = /<publication>/;
  return regex.test(fileContents);
}
