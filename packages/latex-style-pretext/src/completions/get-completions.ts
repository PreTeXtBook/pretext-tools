import {
  Command,
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from "vscode-languageserver-types";
import type { EnvironmentSpec, GetCompletionsParams } from "../types";
import {
  scanDocument,
  contextAt,
  type ScanContext,
} from "../scan/scan-document";
import { ENVIRONMENTS } from "../data/environments";
import { MACROS } from "../data/macros";
import {
  DISPLAY_MATH_ENVIRONMENTS,
  EXTRA_MATH_MACROS,
  KATEX_ENVIRONMENTS,
  KATEX_MACROS,
} from "../data/math";
import { PLUS_TYPES, PLUS_TYPE_KIND } from "../data/plus";
import { rangeFromOffsets } from "../util/position";
import {
  ENVIRONMENT_SKELETON,
  environmentInsertText,
  endInsertText,
  macroInsertText,
} from "./snippets";

/** Ref-style macros that resolve against `\label{}` targets, keyed by delimiter. */
const REF_MACROS_BRACE = ["ref", "eqref", "cref", "Cref", "autoref", "nameref"];

// Both are editor commands, so they work in VS Code and Monaco alike. A host
// that drops them only loses the automation: the skeleton still works by hand.
const OPEN_SUGGESTIONS: Command = {
  title: "Suggest",
  command: "editor.action.triggerSuggest",
};
const NEXT_TAB_STOP: Command = {
  title: "Next tab stop",
  command: "jumpToNextSnippetPlaceholder",
};

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
    if (which === "begin" && inEnvironmentSkeleton(text, offset, prefix)) {
      const edit = { start: offset - prefix.length, end: offset };
      return environmentBeginItems(text, edit, ctx, true);
    }
    const edit = braceEdit(text, offset, prefix.length);
    return which === "begin"
      ? environmentBeginItems(text, edit, ctx, false)
      : environmentEndItems(text, edit, ctx.envStack);
  }

  // `\plus{...}` — PreTeXt Plus include types.
  const plusMatch = /\\plus\s*(?:\[[^\]]*\])?\s*\{([a-zA-Z-]*)$/.exec(before);
  if (plusMatch) {
    const prefix = plusMatch[1];
    const edit = braceEdit(text, offset, prefix.length);
    return plusTypeItems(text, edit, prefix);
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

/**
 * The environments that can begin at the cursor. In a skeleton the rest of the
 * environment is already written, so choosing one supplies just the name and
 * moves on to the body; otherwise it writes the whole environment.
 */
function environmentBeginItems(
  text: string,
  edit: CursorEdit,
  ctx: ScanContext,
  inSkeleton: boolean,
): CompletionItem[] {
  const item = (
    spec: Pick<EnvironmentSpec, "name" | "snippet" | "documentation">,
    detail: string,
    sortText: string,
  ) =>
    makeItem({
      text,
      edit,
      label: spec.name,
      kind: CompletionItemKind.Class,
      detail,
      documentation: spec.documentation,
      sortText,
      ...(inSkeleton
        ? { insert: spec.name, plainText: true, command: NEXT_TAB_STOP }
        : { insert: environmentInsertText(spec) }),
    });

  if (ctx.mode === "math") {
    return [...KATEX_ENVIRONMENTS].map((name) =>
      item({ name }, "environment · math", `1${name}`),
    );
  }

  const { currentEnvironment } = ctx;
  const boosted = new Set(
    (currentEnvironment &&
      ENVIRONMENTS.find((e) => e.name === currentEnvironment)
        ?.childEnvironments) ||
      [],
  );

  const items: CompletionItem[] = [];
  for (const spec of ENVIRONMENTS) {
    const detailBits: string[] = [spec.kind];
    if (spec.requiresStatement) detailBits.push("statement");
    const boost = boosted.has(spec.name);
    // Only the canonical name is suggested; aliases remain valid input (and are
    // still recognized by validation) but are kept out of the suggestion list.
    items.push(
      item(
        spec,
        `environment · ${detailBits.join(", ")}`,
        // Boosted children sort first, then everything alphabetically.
        `${boost ? "0" : "1"}${spec.name}`,
      ),
    );
  }
  for (const name of DISPLAY_MATH_ENVIRONMENTS) {
    items.push(item({ name }, "environment · display math", `1${name}`));
  }
  return items;
}

/**
 * `\begin{...}`: the whole environment, then straight on to choosing its name.
 * Sorts first because it is the usual reason to type a bare `\`.
 */
function beginKeywordItems(
  text: string,
  edit: CursorEdit,
  prefix: string,
): CompletionItem[] {
  if (!"begin".startsWith(prefix)) return [];
  return [
    makeItem({
      text,
      edit,
      label: "\\begin{...}",
      filterText: "begin",
      kind: CompletionItemKind.Keyword,
      detail: "begin an environment",
      insert: ENVIRONMENT_SKELETON,
      sortText: "0begin",
      command: OPEN_SUGGESTIONS,
    }),
  ];
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

/**
 * Include types for `\plus{type}{ref}`. Completing the type also opens the
 * `{ref}` argument, unless one is already written after the cursor.
 */
function plusTypeItems(
  text: string,
  edit: CursorEdit,
  prefix: string,
): CompletionItem[] {
  const hasRefArgument = text[edit.end] === "{";
  const items: CompletionItem[] = [];
  for (const name of PLUS_TYPES) {
    if (prefix && !name.startsWith(prefix)) continue;
    const kind = PLUS_TYPE_KIND.get(name);
    items.push(
      makeItem({
        text,
        edit,
        label: name,
        kind: CompletionItemKind.Module,
        detail: `plus include · ${kind}`,
        insert: `${name}}${hasRefArgument ? "" : "{$1}"}`,
        // Divisions are the common case, so they sort above assets.
        sortText: `${kind === "division" ? "0" : "1"}${name}`,
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
  const items = beginKeywordItems(text, edit, prefix);
  if ("end".startsWith(prefix)) {
    items.push(
      makeItem({
        text,
        edit,
        label: "end",
        kind: CompletionItemKind.Keyword,
        detail: "end an environment",
        insert: "end{$1}",
        sortText: "0end",
      }),
    );
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
  const items = beginKeywordItems(text, edit, prefix);
  const push = (name: string, detail: string) => {
    if (prefix && !name.startsWith(prefix)) return;
    // KaTeX's list includes single-symbol control words (e.g. `\,`); only offer
    // letter-named macros through the `\word` completion path.
    if (!/^[a-zA-Z]/.test(name)) return;
    if (name === "begin") return;
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
 * Whether the name at the cursor belongs to a `\begin{name}...\end{name}` pair
 * with nothing in between: the `\begin{...}` snippet, whose `\end{...}` mirrors
 * what is typed. The names must agree, or typing `\begin{` just above the
 * `\end{theorem}` of an enclosing environment would count.
 */
function inEnvironmentSkeleton(
  text: string,
  offset: number,
  name: string,
): boolean {
  const match = /^\}\s*\\end\{([a-zA-Z0-9*-]*)\}/.exec(text.slice(offset));
  return match?.[1] === name;
}

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
  filterText?: string;
  plainText?: boolean;
  command?: Command;
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
  if (args.filterText) item.filterText = args.filterText;
  if (args.command) item.command = args.command;
  if (args.documentation) {
    item.documentation = {
      kind: MarkupKind.Markdown,
      value: args.documentation,
    };
  }
  return item;
}
