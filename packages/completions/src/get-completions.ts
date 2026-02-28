import { glob } from "glob";
import path from "path";
import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
} from "vscode-languageserver/node";
import {
  CompletionType,
  GetPretextCompletionsParams,
  ReferenceEntry,
} from "./types";
import { ATTRIBUTES, ELEMENTS, EXTRA_ELEMENT_SNIPPETS } from "./constants";
import { getCurrentTag, getTextInRange, linePrefix, rangeInLine } from "./utils";

export function getCompletionType(
  text: string,
  position: GetPretextCompletionsParams["position"],
): CompletionType {
  const prefix = linePrefix(text, position);
  const match = prefix.match(/<[^>/]+$/);
  if (match) {
    if (match[0].match(/<xref ref="[^"]*$/)) {
      return "ref";
    }
    if (match[0].match(/(href|source)="[^"]*$/)) {
      return "file";
    }
    return "attribute";
  }
  return "element";
}

export async function getPretextCompletions(
  params: GetPretextCompletionsParams,
): Promise<CompletionItem[] | null> {
  const { text, position, schema } = params;
  const completionType = getCompletionType(text, position);
  let completionItems: CompletionItem[] = [];

  if (completionType === "file") {
    const currentFileDir = params.currentFileDir || ".";
    const files = params.sourceFiles || glob.sync("source/**", { nodir: true });
    completionItems = files.flatMap((f) => {
      let relPath = path.relative(currentFileDir, path.resolve(f));
      relPath = relPath.replaceAll(path.sep, path.posix.sep);
      return [
        { label: relPath, kind: CompletionItemKind.File },
        { label: "./" + relPath, kind: CompletionItemKind.File },
      ];
    });
    return completionItems;
  }

  if (completionType === "ref") {
    completionItems = getRefCompletions(params.references || []);
    return completionItems;
  }

  const charsBefore = getTextInRange(text, rangeInLine(position, -2, 0));
  if (
    charsBefore.length !== 0 &&
    !charsBefore.includes(" ") &&
    !charsBefore.includes("\t")
  ) {
    return null;
  }

  if (completionType === "attribute") {
    completionItems = getAttributeCompletions(params);
  } else if (completionType === "element") {
    completionItems = getElementCompletions(params);
  }

  return completionItems;
}

function getRefCompletions(references: ReferenceEntry[]): CompletionItem[] {
  return references.map(([reference, parent]) => ({
    label: reference,
    kind: CompletionItemKind.Reference,
    documentation: "(a " + parent + ")",
    detail: "(reference to " + parent + ")",
    sortText: "0" + reference,
  }));
}

function getAttributeCompletions(
  params: GetPretextCompletionsParams,
): CompletionItem[] {
  const { text, position, schema } = params;
  const prefix = linePrefix(text, position);
  const match = prefix.match(/<[^>/]+$/);
  if (!match) {
    return [];
  }

  const element = match[0].slice(1, match[0].indexOf(" "));
  if (!schema.elementChildren[element]?.attributes) {
    return [];
  }

  const range =
    getTextInRange(text, rangeInLine(position, -1, 0)) === "@"
      ? rangeInLine(position, -1, 0)
      : rangeInLine(position);

  return schema.elementChildren[element].attributes.map((attr) => {
    if (attr in ATTRIBUTES) {
      const base = ATTRIBUTES[attr];
      const insertText = base.insertText || attr;
      return {
        ...base,
        insertText,
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: {
          newText: insertText,
          range,
        },
        kind: CompletionItemKind.TypeParameter,
      };
    }

    return {
      label: "@" + attr,
      kind: CompletionItemKind.TypeParameter,
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: {
        newText: `${attr}="$1"$0`,
        range,
      },
    };
  });
}

function getElementCompletions(
  params: GetPretextCompletionsParams,
): CompletionItem[] {
  const { text, position, schema } = params;
  const element = getCurrentTag(text, position);

  if (!element || !schema.elementChildren[element]?.elements) {
    return [];
  }

  const range =
    getTextInRange(text, rangeInLine(position, -1, 0)) === "<"
      ? rangeInLine(position, -1, 0)
      : rangeInLine(position);

  const completionItems: CompletionItem[] = [];
  for (const elem of schema.elementChildren[element].elements) {
    if (elem in ELEMENTS) {
      const base = ELEMENTS[elem];
      const insertText = base.insertText || elem;
      completionItems.push({
        ...base,
        insertText,
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: {
          newText: insertText,
          range,
        },
        kind: CompletionItemKind.TypeParameter,
        sortText: base.sortText || elem,
      });
    } else {
      completionItems.push({
        label: "<" + elem,
        kind: CompletionItemKind.TypeParameter,
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: {
          newText: `<${elem}>$1</${elem}>$0`,
          range,
        },
        documentation: "Generic implementation for element " + elem,
      });
    }
  }

  completionItems.push({
    label: "</" + element,
    kind: CompletionItemKind.TypeParameter,
    insertTextFormat: InsertTextFormat.Snippet,
    textEdit: {
      newText: `</${element}>$0`,
      range,
    },
  });

  completionItems.push(...getExtraCompletions(element, range, schema));
  return completionItems;
}

function getExtraCompletions(
  element: string,
  range: ReturnType<typeof rangeInLine>,
  schema: GetPretextCompletionsParams["schema"],
): CompletionItem[] {
  const extraCompletions: CompletionItem[] = [];
  for (const item of Object.values(EXTRA_ELEMENT_SNIPPETS)) {
    if (item.parents && !item.parents.includes(element)) {
      continue;
    }
    if (schema.elementChildren[element].elements.includes(item.alias)) {
      extraCompletions.push({
        label: item.label,
        insertText: item.insertText,
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: {
          newText: item.insertText,
          range,
        },
        documentation: item.documentation,
        kind: CompletionItemKind.TypeParameter,
        sortText: item.sortText,
      });
    }
  }
  return extraCompletions;
}
