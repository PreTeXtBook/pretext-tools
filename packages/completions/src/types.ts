import { CompletionItem, Position } from "vscode-languageserver/node";

export type CompletionType = "element" | "attribute" | "file" | "ref";

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
};

export type ReferenceEntry = [string, string, string];

export type GetPretextCompletionsParams = {
  text: string;
  position: Position;
  schema: CompletionSchema;
  references?: ReferenceEntry[];
  currentFileDir?: string;
  sourceFiles?: string[];
};
