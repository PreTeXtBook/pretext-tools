import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
} from "vscode-languageserver-types";
import {
  CompletionSchema,
  CompletionType,
  GetPretextCompletionsParams,
  ReferenceEntry,
} from "./types";
import { defaultDevSchema } from "./default-dev-schema";
import { ATTRIBUTES, ELEMENTS, EXTRA_ELEMENT_SNIPPETS } from "./constants";
import {
  getCurrentTag,
  getTextInRange,
  linePrefix,
  lineSuffix,
  rangeInLine,
} from "./utils";

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath);
}

function toPathSegments(filePath: string): string[] {
  return filePath.replace(/\/+$/, "").split("/").filter(Boolean);
}

function toRelativeFilePath(filePath: string, currentFileDir?: string): string {
  const normalizedFilePath = normalizePath(filePath);
  if (!currentFileDir) {
    return normalizedFilePath;
  }

  const normalizedCurrentDir = normalizePath(currentFileDir);
  if (
    !isAbsolutePath(normalizedFilePath) ||
    !isAbsolutePath(normalizedCurrentDir)
  ) {
    return normalizedFilePath;
  }

  const fileSegments = toPathSegments(normalizedFilePath);
  const currentDirSegments = toPathSegments(normalizedCurrentDir);

  // Windows paths are case-insensitive; normalize for segment comparison.
  const fileComparable = fileSegments.map((seg) => seg.toLowerCase());
  const currentComparable = currentDirSegments.map((seg) => seg.toLowerCase());

  let commonPrefixLength = 0;
  while (
    commonPrefixLength < fileComparable.length &&
    commonPrefixLength < currentComparable.length &&
    fileComparable[commonPrefixLength] === currentComparable[commonPrefixLength]
  ) {
    commonPrefixLength += 1;
  }

  if (commonPrefixLength === 0) {
    return normalizedFilePath;
  }

  const parentSegments = Array.from(
    { length: currentDirSegments.length - commonPrefixLength },
    () => "..",
  );
  const childSegments = fileSegments.slice(commonPrefixLength);
  const relativeSegments = [...parentSegments, ...childSegments];
  return relativeSegments.join("/");
}

function withOptionalDotPrefix(filePath: string): string {
  if (
    filePath.startsWith("./") ||
    filePath.startsWith("../") ||
    filePath.startsWith("/") ||
    /^[A-Za-z]:\//.test(filePath)
  ) {
    return filePath;
  }
  return "./" + filePath;
}

/** A start tag's name up to the caret: `<` and whatever of the name is typed. */
const TAG_NAME_BEFORE = /<([A-Za-z_][\w.:-]*)?$/;

/** The rest of a start tag's name, then the end of the tag. */
const TAG_NAME_AFTER = /^[\w.:-]*>/;

export function getCompletionType(
  text: string,
  position: GetPretextCompletionsParams["position"],
): CompletionType {
  const prefix = linePrefix(text, position);
  // The name of a start tag that is already complete, like the `<|>` a
  // selection wrapped by typing `<` gets, with its end tag mirroring it.
  if (
    TAG_NAME_BEFORE.test(prefix) &&
    TAG_NAME_AFTER.test(lineSuffix(text, position))
  ) {
    return "tagName";
  }
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
  const { text, position } = params;
  const schema = params.schema ?? defaultDevSchema;
  const completionType = getCompletionType(text, position);
  let completionItems: CompletionItem[] = [];

  if (completionType === "file") {
    const files = params.sourceFiles || [];
    const labels = new Set<string>();
    completionItems = files.flatMap((f) => {
      const relPath = toRelativeFilePath(f, params.currentFileDir);
      const dotRelative = withOptionalDotPrefix(relPath);
      const items: CompletionItem[] = [];

      for (const label of [relPath, dotRelative]) {
        if (label && !labels.has(label)) {
          labels.add(label);
          items.push({ label, kind: CompletionItemKind.File });
        }
      }

      return items;
    });
    return completionItems;
  }

  if (completionType === "ref") {
    completionItems = getRefCompletions(params.references || []);
    return completionItems;
  }

  if (completionType === "tagName") {
    return getTagNameCompletions(params, schema);
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
    completionItems = getAttributeCompletions(params, schema);
  } else if (completionType === "element") {
    completionItems = getElementCompletions(params, schema);
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
  schema: NonNullable<GetPretextCompletionsParams["schema"]>,
): CompletionItem[] {
  const { text, position } = params;
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

/**
 * Bare element names for the name of a start tag that is already complete:
 * the tag is there, only its name is missing (or being changed). The edit
 * covers just the name, not the `<`, so where an end tag mirrors it (one
 * caret in each tag) the editor makes the same edit at both carets.
 */
function getTagNameCompletions(
  params: GetPretextCompletionsParams,
  schema: NonNullable<GetPretextCompletionsParams["schema"]>,
): CompletionItem[] {
  const { text, position } = params;
  const typed = TAG_NAME_BEFORE.exec(linePrefix(text, position))?.[1] ?? "";
  const rest = TAG_NAME_AFTER.exec(lineSuffix(text, position))![0].length - 1;
  const parent = getCurrentTag(text, {
    line: position.line,
    character: position.character - typed.length - 1,
  });
  const names =
    (parent && schema.elementChildren[parent]?.elements) ||
    Object.keys(schema.elementChildren);
  const range = rangeInLine(position, -typed.length, rest);

  return names.map((name) => {
    const base = ELEMENTS[name];
    return {
      label: name,
      kind: CompletionItemKind.TypeParameter,
      documentation: base?.documentation,
      sortText: base?.sortText || name,
      textEdit: { newText: name, range },
    };
  });
}

function getElementCompletions(
  params: GetPretextCompletionsParams,
  schema: NonNullable<GetPretextCompletionsParams["schema"]>,
): CompletionItem[] {
  const { text, position } = params;
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
        // Editors fall back to the label ("<elem") when sortText is missing,
        // and "<" sorts before every letter, which would rank all generic
        // elements above the curated ones (`<quantity` above `<q>`).
        sortText: elem,
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
  schema: CompletionSchema,
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
        sortText: item.sortText || item.alias,
      });
    }
  }
  return extraCompletions;
}
