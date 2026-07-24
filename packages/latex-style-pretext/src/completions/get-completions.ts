import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from "vscode-languageserver-types";
import type { GetCompletionsParams } from "../types";
import { scanDocument, contextAt } from "../scan/scan-document";
import { ENVIRONMENTS } from "../data/environments";
import { MACROS } from "../data/macros";
import { KATEX_MACROS, EXTRA_MATH_MACROS } from "../data/math";
import { rangeFromOffsets } from "../util/position";
import {
  environmentInsertText,
  endInsertText,
  macroInsertText,
} from "./snippets";

/** Ref-style macros that resolve against `\label{}` targets, keyed by delimiter. */
const REF_MACROS_BRACE = ["ref", "eqref", "cref", "Cref", "autoref", "nameref"];

interface CursorEdit {
  /** Offset where the replaced text begins. */
  start: number;
  /** Offset where it ends (may consume an auto-closed bracket). */
  end: number;
}

/**
 * Main entry point: given the document text and a cursor offset, return the
 * completions appropriate to the cursor's syntactic context.
 */
export function getLatexCompletions(
  params: GetCompletionsParams,
): CompletionItem[] {
  const { text, offset } = params;
  const scan = scanDocument(text);
  const ctx = contextAt(scan, offset);

  // No completions inside comments or verbatim (code/program/...) content.
  if (ctx.inComment || ctx.inVerbatim) return [];

  const before = text.slice(0, offset);

  // `\begin{...}` / `\end{...}` — environment names.
  const envMatch = /\\(begin|end)\{([a-zA-Z0-9*-]*)$/.exec(before);
  if (envMatch) {
    const which = envMatch[1] as "begin" | "end";
    const prefix = envMatch[2];
    const edit = braceEdit(text, offset, prefix.length);
    return which === "begin"
      ? environmentBeginItems(text, edit, ctx.currentEnvironment)
      : environmentEndItems(text, edit, ctx.envStack);
  }

  // `\ref{...}` and friends — label targets.
  const refBrace = new RegExp(
    `\\\\(${REF_MACROS_BRACE.join("|")})\\{([a-zA-Z0-9:_.-]*)$`,
  ).exec(before);
  const refBracket = /\\hyperref\[([a-zA-Z0-9:_.-]*)$/.exec(before);
  if (refBrace || refBracket) {
    const prefix = refBrace ? refBrace[2] : refBracket![1];
    const closer = refBrace ? "}" : "]";
    const edit = closerEdit(text, offset, prefix.length, closer);
    return labelItems(text, edit, scan.labels);
  }

  // `\macro` — text- or math-mode macros.
  const macroMatch = /\\([a-zA-Z]*)$/.exec(before);
  if (macroMatch) {
    const prefix = macroMatch[1];
    const edit: CursorEdit = { start: offset - prefix.length, end: offset };
    return ctx.mode === "math"
      ? mathMacroItems(text, edit, prefix)
      : textMacroItems(text, edit, prefix);
  }

  return [];
}

// --- context-specific item builders ---------------------------------------

function environmentBeginItems(
  text: string,
  edit: CursorEdit,
  currentEnvironment: string | undefined,
): CompletionItem[] {
  const boosted = new Set(
    (currentEnvironment &&
      ENVIRONMENTS.find((e) => e.name === currentEnvironment)
        ?.childEnvironments) ||
      [],
  );

  const items: CompletionItem[] = [];
  for (const spec of ENVIRONMENTS) {
    const insert = environmentInsertText(spec);
    const detailBits: string[] = [spec.kind];
    if (spec.requiresStatement) detailBits.push("statement");
    const boost = boosted.has(spec.name);
    items.push(
      makeItem({
        text,
        edit,
        label: spec.name,
        kind: CompletionItemKind.Class,
        detail: `environment · ${detailBits.join(", ")}`,
        documentation: spec.documentation,
        insert,
        // Boosted children sort first, then everything alphabetically.
        sortText: `${boost ? "0" : "1"}${spec.name}`,
      }),
    );
    for (const alias of spec.aliases) {
      items.push(
        makeItem({
          text,
          edit,
          label: alias,
          kind: CompletionItemKind.Class,
          detail: `alias of \\begin{${spec.name}}`,
          insert: environmentInsertText({ ...spec, name: alias }),
          sortText: `2${alias}`,
        }),
      );
    }
  }
  return items;
}

function environmentEndItems(
  text: string,
  edit: CursorEdit,
  envStack: string[],
): CompletionItem[] {
  const innermost = envStack[envStack.length - 1];
  const items: CompletionItem[] = [];
  if (innermost) {
    items.push(
      makeItem({
        text,
        edit,
        label: innermost,
        kind: CompletionItemKind.Class,
        detail: "closes the current environment",
        insert: endInsertText(innermost),
        sortText: `0${innermost}`,
      }),
    );
  }
  // Also offer every open environment, outermost-in.
  for (let i = envStack.length - 2; i >= 0; i--) {
    const name = envStack[i];
    items.push(
      makeItem({
        text,
        edit,
        label: name,
        kind: CompletionItemKind.Class,
        detail: "closes an open environment",
        insert: endInsertText(name),
        sortText: `1${envStack.length - i}`,
      }),
    );
  }
  return items;
}

function labelItems(
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
        detail: "label",
        insert: name,
        plainText: true,
      }),
    );
  }
  return items;
}

function textMacroItems(
  text: string,
  edit: CursorEdit,
  prefix: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  // Synthetic entries so `\beg` expands into a full environment.
  for (const kw of ["begin", "end"] as const) {
    if (kw.startsWith(prefix)) {
      items.push(
        makeItem({
          text,
          edit,
          label: kw,
          kind: CompletionItemKind.Keyword,
          detail: `${kw} an environment`,
          insert: `${kw}{$1}`,
          sortText: `0${kw}`,
        }),
      );
    }
  }
  for (const spec of MACROS) {
    if (prefix && !spec.name.startsWith(prefix)) continue;
    items.push(
      makeItem({
        text,
        edit,
        label: spec.name,
        kind: CompletionItemKind.Function,
        detail: spec.signature
          ? `macro · \\${spec.name} ${spec.signature}`
          : "macro",
        documentation: spec.documentation,
        insert: macroInsertText(spec),
        sortText: `1${spec.name}`,
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

// --- edit-range helpers ----------------------------------------------------

/**
 * Replacement range for an environment name typed after `\begin{`/`\end{`.
 * The generated snippet supplies its own closing `}`, so if the editor already
 * auto-closed the brace we extend the range to swallow it.
 */
function braceEdit(
  text: string,
  offset: number,
  prefixLen: number,
): CursorEdit {
  return closerEdit(text, offset, prefixLen, "}");
}

function closerEdit(
  text: string,
  offset: number,
  prefixLen: number,
  closer: string,
): CursorEdit {
  const end = text[offset] === closer ? offset + 1 : offset;
  return { start: offset - prefixLen, end };
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
