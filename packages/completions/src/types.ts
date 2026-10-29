import { CompletionItem, Position } from "vscode-languageserver-types";

export type CompletionType =
  | "element"
  | "tagName"
  | "template"
  | "attribute"
  | "file"
  | "ref";

export type CompletionItems = {
  [key: string]: CompletionItem;
};

export type SchemaElementChildren = {
  [key: string]: {
    elements: string[];
    attributes: string[];
  };
};

export type CompletionSchema = {
  elementChildren: SchemaElementChildren;
  /**
   * The elements the grammar allows as a document's root (its `<start>`), e.g.
   * `pretext` and the divisions a modular `xi:include`d file may begin with.
   * Omitted by schemas built before this was recorded; every element is then
   * taken to be a possible root.
   */
  rootElements?: string[];
};

export type ReferenceEntry = [string, string, string];

export type GetPretextCompletionsParams = {
  text: string;
  position: Position;
  schema?: CompletionSchema;
  references?: ReferenceEntry[];
  currentFileDir?: string;
  sourceFiles?: string[];
};
