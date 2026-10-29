import * as path from "path";
import { Snippets } from "../../types";
import { elementChildren } from "../../constants";
import {
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  InsertTextFormat,
  Range,
  Position,
} from "vscode-languageserver";
import { documents } from "../state";
import { TextDocument } from "vscode-languageserver-textdocument";
import { resolveRootSourcesFromManifest } from "../../project-manifest";
import {
  projectFileUris,
  readProjectFile,
  readProjectText,
  uriToPath,
} from "../project-files";
import { isProjectPtx } from "../projectPtx/is-project-ptx";

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

/**
 * The root source files of every project in the snapshot: each `project.ptx`
 * resolved through the shared manifest resolver (so this agrees with
 * validation and the outline on where a book starts). A workspace with no
 * manifest falls back to every `main.ptx` it contains.
 */
function getRootDocuments(): string[] {
  const roots = new Set<string>();
  const uris = projectFileUris();
  for (const uri of uris) {
    if (!isProjectPtx(uri)) {
      continue;
    }
    const manifest = readProjectText(uri);
    if (manifest === undefined) {
      continue;
    }
    const projectRoot = path.dirname(uriToPath(uri));
    for (const root of resolveRootSourcesFromManifest(manifest, projectRoot)) {
      roots.add(root);
    }
  }
  if (roots.size === 0) {
    for (const uri of uris) {
      if (/\/main\.ptx$/.test(uri)) {
        roots.add(uriToPath(uri));
      }
    }
  }
  return [...roots];
}

// define a type for the array of labels:
type LabelArray = [string, string, string][];

/**
 * Search through a project to find all xml:id's.  Start with each root source
 * file and include any file that is xi:included up to a depth of 5. Reads go
 * through the project snapshot, never the filesystem.
 */
export function getReferences(): LabelArray {
  let references: LabelArray = [];
  let files = getRootDocuments();
  const visited = new Set<string>();
  let depth = 0;
  while (depth < 5 && files.length > 0) {
    let newFiles: string[] = [];
    for (const file of files) {
      if (visited.has(file)) {
        continue;
      }
      visited.add(file);
      const text = readProjectFile(file);
      if (text === undefined) {
        continue;
      }
      let regex = /<xi:include\s+href="([^"]+)"/g;
      let matches = [...text.matchAll(regex)];
      newFiles = newFiles.concat(
        matches.map((match) => path.resolve(path.dirname(file), match[1])),
      );
      regex = /<(\w*?)\s(.*?)xml:id="([^"]+?)"/g;
      matches = [...text.matchAll(regex)];
      const posixFile = file.replace(/\\/g, "/");
      references = references.concat(
        matches.map((match) => [match[3], match[1], posixFile]),
      );
    }
    files = newFiles;
    depth++;
  }
  console.log("Finished collecting references, reached depth of ", depth);
  return references;
}

export function isPublicationPtx(document: TextDocument): boolean {
  // Look for a starting tag of <publication> in the file.
  let fileContents = document.getText();
  let regex = /<publication>/;
  return regex.test(fileContents);
}
