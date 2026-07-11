import { CompletionItem } from "vscode-languageserver";

type SpellCheckScope = {
  comments: "Check" | "Ignore";
  inlineMath: "Check" | "Ignore";
  displayMath: "Check" | "Ignore";
  inlineCode: "Check" | "Ignore";
  blockCode: "Check" | "Ignore";
  latexImage: "Check" | "Ignore";
  tags: "Check" | "Ignore";
};

type CompletionItems = {
  [key: string]: CompletionItem;
};

export {
  CompletionType,
  CompletionItems,
  SpellCheckScope,
  Snippet,
  Snippets,
  Project,
};

// Set up types:
export type LabelArray = [string, string, string][];
export type Target = {
  name: string;
  path: string;
  standalone?: boolean;
  filename?: string;
};
// Types for snippets
type Snippet = {
  prefix: string;
  body: string;
  description?: string;
  sort?: string;
  retrigger?: boolean;
};

type Snippets = {
  [key: string]: Snippet;
};

type CompletionType = "element" | "attribute" | "file" | "ref";

type Project = {
  root: string;
  targets: Target[];
  systemDefault?: boolean;
};
