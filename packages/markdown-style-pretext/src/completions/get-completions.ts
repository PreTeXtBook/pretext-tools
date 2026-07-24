import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from "vscode-languageserver-types";
import type { GetCompletionsParams } from "../types";
import { scanDocument, contextAt } from "../scan/scan-document";
import { CONTAINER_DIRECTIVES, LEAF_DIRECTIVES } from "../data/directives";
import { KATEX_MACROS, EXTRA_MATH_MACROS } from "../data/math";
import { rangeFromOffsets } from "../util/position";
import {
  containerInsertText,
  leafInsertText,
  pythonInsertText,
} from "./snippets";

// A container fence line up to the cursor: leading space, `:::`+, optional name.
const CONTAINER_CONTEXT_RE = /^[ \t]*:{3,}[ \t]*([A-Za-z][\w-]*)?$/;
// A leaf directive line up to the cursor: exactly two colons, optional name.
const LEAF_CONTEXT_RE = /^[ \t]*::(?!:)([A-Za-z][\w-]*)?$/;
// A python-style marker being typed: a bare word at the start of the line.
const PYTHON_CONTEXT_RE = /^[ \t]*([A-Za-z][A-Za-z0-9_-]*)$/;
// A markdown cross-reference link target: `](#id`.
const XREF_CONTEXT_RE = /\]\(#([\w:.-]*)$/;
// A math macro being typed: `\name`.
const MATH_MACRO_RE = /\\([A-Za-z]*)$/;

interface CursorEdit {
  start: number;
  end: number;
}

/**
 * Main entry point: given the document text and a cursor offset, return the
 * completions appropriate to the cursor's syntactic context.
 */
export function getMarkdownCompletions(
  params: GetCompletionsParams,
): CompletionItem[] {
  const { text, offset } = params;
  const scan = scanDocument(text);
  const ctx = contextAt(scan, offset);

  // No completions inside fenced code, HTML comments, or YAML frontmatter.
  if (ctx.inCode || ctx.inComment || ctx.inFrontmatter) return [];

  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = before.slice(lineStart);

  // `:::` at the start of a line — container directive names.
  const container = CONTAINER_CONTEXT_RE.exec(currentLine);
  if (container && ctx.mode !== "math") {
    const prefix = container[1] ?? "";
    const edit: CursorEdit = { start: offset - prefix.length, end: offset };
    return containerItems(text, edit, prefix, ctx.currentDirective);
  }

  // `::` at the start of a line — leaf (include) directive names.
  const leaf = LEAF_CONTEXT_RE.exec(currentLine);
  if (leaf && ctx.mode !== "math") {
    const prefix = leaf[1] ?? "";
    const edit: CursorEdit = { start: offset - prefix.length, end: offset };
    return leafItems(text, edit, prefix);
  }

  // A bare word at the start of a line — python-style directive markers. Only
  // words that prefix a real directive name produce items, so ordinary prose
  // (which almost never begins with a directive name) stays quiet.
  const python = PYTHON_CONTEXT_RE.exec(currentLine);
  if (python && ctx.mode !== "math") {
    const prefix = python[1];
    const edit: CursorEdit = { start: offset - prefix.length, end: offset };
    const items = pythonItems(text, edit, prefix, ctx.currentDirective);
    if (items.length > 0) return items;
  }

  // `](#…` — cross-reference against harvested ids.
  const xref = XREF_CONTEXT_RE.exec(before);
  if (xref) {
    const prefix = xref[1];
    const closer = text[offset] === ")" ? offset + 1 : offset;
    const edit: CursorEdit = { start: offset - prefix.length, end: closer };
    return xrefItems(text, edit, scan.labels);
  }

  // `\macro` inside math — KaTeX macros.
  if (ctx.mode === "math") {
    const macro = MATH_MACRO_RE.exec(before);
    if (macro) {
      const prefix = macro[1];
      const edit: CursorEdit = { start: offset - prefix.length, end: offset };
      return mathMacroItems(text, edit, prefix);
    }
  }

  return [];
}

// --- context-specific item builders ---------------------------------------

function containerItems(
  text: string,
  edit: CursorEdit,
  prefix: string,
  currentDirective: string | undefined,
): CompletionItem[] {
  const boosted = new Set(
    (currentDirective &&
      CONTAINER_DIRECTIVES.find((d) => d.name === currentDirective)
        ?.childDirectives) ||
      [],
  );

  const items: CompletionItem[] = [];
  for (const spec of CONTAINER_DIRECTIVES) {
    if (prefix && !spec.name.startsWith(prefix)) continue;
    const detailBits: string[] = [spec.category];
    if (spec.requiresStatement) detailBits.push("statement");
    const boost = boosted.has(spec.name);
    items.push(
      makeItem({
        text,
        edit,
        label: spec.name,
        kind: CompletionItemKind.Class,
        detail: `directive · ${detailBits.join(", ")}`,
        documentation: spec.documentation,
        insert: containerInsertText(spec),
        // Boosted children sort first, then everything alphabetically.
        sortText: `${boost ? "0" : "1"}${spec.name}`,
      }),
    );
  }
  return items;
}

function pythonItems(
  text: string,
  edit: CursorEdit,
  prefix: string,
  currentDirective: string | undefined,
): CompletionItem[] {
  // Case-insensitive: authors write `Theorem:`, the converter lowercases it.
  const lower = prefix.toLowerCase();
  const boosted = new Set(
    (currentDirective &&
      CONTAINER_DIRECTIVES.find((d) => d.name === currentDirective)
        ?.childDirectives) ||
      [],
  );

  const items: CompletionItem[] = [];
  for (const spec of CONTAINER_DIRECTIVES) {
    if (!spec.name.startsWith(lower)) continue;
    const boost = boosted.has(spec.name);
    items.push(
      makeItem({
        text,
        edit,
        label: `${spec.name}:`,
        kind: CompletionItemKind.Class,
        detail: `directive (indented) · ${spec.category}`,
        documentation: spec.documentation,
        insert: pythonInsertText(spec),
        sortText: `${boost ? "0" : "1"}${spec.name}`,
      }),
    );
  }
  return items;
}

function leafItems(
  text: string,
  edit: CursorEdit,
  prefix: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const spec of LEAF_DIRECTIVES) {
    if (prefix && !spec.name.startsWith(prefix)) continue;
    items.push(
      makeItem({
        text,
        edit,
        label: spec.name,
        kind: CompletionItemKind.Module,
        detail: "include · plus:" + spec.name,
        documentation: spec.documentation,
        insert: leafInsertText(spec),
      }),
    );
  }
  return items;
}

function xrefItems(
  text: string,
  edit: CursorEdit,
  labels: { name: string }[],
): CompletionItem[] {
  const seen = new Set<string>();
  const items: CompletionItem[] = [];
  for (const { name } of labels) {
    if (seen.has(name)) continue;
    seen.add(name);
    items.push(
      makeItem({
        text,
        edit,
        label: name,
        kind: CompletionItemKind.Reference,
        detail: "cross-reference target",
        insert: name,
        plainText: true,
      }),
    );
  }
  return items;
}

function mathMacroItems(
  text: string,
  edit: CursorEdit,
  prefix: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const push = (name: string, detail: string) => {
    if (prefix && !name.startsWith(prefix)) return;
    // KaTeX's list includes single-symbol control words (e.g. `\,`); only offer
    // letter-named macros through the `\word` completion path.
    if (!/^[a-zA-Z]/.test(name)) return;
    items.push(
      makeItem({
        text,
        edit,
        label: name,
        kind: CompletionItemKind.Function,
        detail,
        insert: name,
        plainText: true,
      }),
    );
  };
  for (const name of KATEX_MACROS) push(name, "math macro (KaTeX)");
  for (const name of EXTRA_MATH_MACROS) push(name, "math macro");
  return items;
}

// --- item construction -----------------------------------------------------

function makeItem(args: {
  text: string;
  edit: CursorEdit;
  label: string;
  kind: CompletionItemKind;
  detail?: string;
  documentation?: string;
  insert: string;
  sortText?: string;
  plainText?: boolean;
}): CompletionItem {
  const item: CompletionItem = {
    label: args.label,
    kind: args.kind,
    insertTextFormat: args.plainText
      ? InsertTextFormat.PlainText
      : InsertTextFormat.Snippet,
    textEdit: {
      range: rangeFromOffsets(args.text, args.edit.start, args.edit.end),
      newText: args.insert,
    },
  };
  if (args.detail) item.detail = args.detail;
  if (args.sortText) item.sortText = args.sortText;
  if (args.documentation) {
    item.documentation = {
      kind: MarkupKind.Markdown,
      value: args.documentation,
    };
  }
  return item;
}
