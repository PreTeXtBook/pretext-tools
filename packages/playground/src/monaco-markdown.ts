// Monaco integration for Markdown-style PreTeXt.
//
// The sibling of `monaco-latex.ts`: pure LSP→Monaco translation with no language
// logic of its own. All intelligence comes from
// `@pretextbook/markdown-style-pretext`; swapping that import and the Monarch
// tokenizer is the only difference from the LaTeX adapter.

import type * as MonacoNS from "monaco-editor";
import {
  pretextMarkdownLanguage,
  PRETEXT_MARKDOWN_LANGUAGE_ID,
} from "@pretextbook/markdown-style-pretext";

type Monaco = typeof MonacoNS;

/** Sample document shown in the demo; also handy for eyeballing behavior. */
export const SAMPLE_DOCUMENT = `---
division: chapter
title: Getting started
---

# Getting started {#sec:intro}

A markdown-style PreTeXt document is CommonMark plus \`:::\` directives. Type
\`:::\` at the start of a line for a directive, or \`::\` for an include.

:::theorem{#thm:main}
Every finite group of prime order is cyclic.

:::proof
Left to the reader.
:::
:::

Inline math works too: $x^2 + \\frac{1}{2}$. A wrong macro like $\\notarealmacro$
is flagged. See [the theorem](#thm:main).

:::exercise
:::task
Show that $2$ is prime.
:::
:::

Python-style indented directives work too — no closing fence needed:

Definition:
    A *prime* is a natural number greater than $1$ with no divisors
    other than $1$ and itself.

    Remark:
        Nested directives just indent further.

<!-- This whole block is a comment, so :::bogus is ignored here. -->

\`\`\`python
# Fenced code: ::: and $x$ are literal here.
print("hi")
\`\`\`

:::bogusdirective
This directive is not supported, so it is flagged.
:::

::::note
A colon fence must be closed by the same number of colons. The fence
below has only three, so it does not match and is flagged.
:::

:::theorem
This theorem is never closed.
`;

// --- language registration -------------------------------------------------

/**
 * Register the `pretext-markdown` language: tokenizer (highlighting), bracket /
 * comment configuration, and a completion provider backed by the core. Safe to
 * call once at startup. Returns the disposable completion provider.
 */
export function registerPretextMarkdown(monaco: Monaco): MonacoNS.IDisposable {
  monaco.languages.register({
    id: PRETEXT_MARKDOWN_LANGUAGE_ID,
    extensions: [".ptx.md"],
    aliases: ["PreTeXt (Markdown)"],
  });

  monaco.languages.setLanguageConfiguration(PRETEXT_MARKDOWN_LANGUAGE_ID, {
    comments: { blockComment: ["<!--", "-->"] },
    brackets: [
      ["{", "}"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "$", close: "$" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "$", close: "$" },
      { open: "*", close: "*" },
      { open: "_", close: "_" },
    ],
  });

  monaco.languages.setMonarchTokensProvider(PRETEXT_MARKDOWN_LANGUAGE_ID, {
    tokenizer: {
      root: [
        // Fenced code blocks: consume to the closing fence.
        [/^\s*```.*$/, { token: "string", next: "@codefence" }],
        [/^\s*~~~.*$/, { token: "string", next: "@codetilde" }],
        // HTML comments (single-line; multi-line handled by @comment).
        [/<!--.*?-->/, "comment"],
        [/<!--/, { token: "comment", next: "@comment" }],
        // Directive fences: `:::name` / `::name` / bare `:::`.
        [/^\s*:{3,}\s*[A-Za-z][\w-]*/, "keyword"],
        [/^\s*:{3,}/, "delimiter"],
        [/^\s*::[A-Za-z][\w-]*/, "type"],
        // Headings.
        [/^\s*#{1,6}\s.*$/, "keyword"],
        // Display and inline math.
        [/\$\$/, { token: "delimiter.math", next: "@displaymath" }],
        [/\$[^$]*\$/, "string.math"],
        // Emphasis / strong.
        [/\*\*[^*]+\*\*/, "strong"],
        [/(\*|_)[^*_]+(\*|_)/, "emphasis"],
        [/`[^`]+`/, "string"],
        [/[{}[\]]/, "delimiter"],
      ],
      codefence: [
        [/^\s*```.*$/, { token: "string", next: "@pop" }],
        [/.*$/, "string"],
      ],
      codetilde: [
        [/^\s*~~~.*$/, { token: "string", next: "@pop" }],
        [/.*$/, "string"],
      ],
      comment: [
        [/-->/, { token: "comment", next: "@pop" }],
        [/.*$/, "comment"],
      ],
      displaymath: [
        [/\$\$/, { token: "delimiter.math", next: "@pop" }],
        [/[^$]+/, "string.math"],
        [/\$/, "string.math"],
      ],
    },
  });

  return monaco.languages.registerCompletionItemProvider(
    PRETEXT_MARKDOWN_LANGUAGE_ID,
    {
      // `:` opens directive contexts, `#` opens a cross-reference, `\` math.
      triggerCharacters: [":", "#", "\\", "{"],
      provideCompletionItems(model, position, context) {
        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        const items = pretextMarkdownLanguage.getCompletions({
          text,
          offset,
          triggerCharacter: context.triggerCharacter,
        });
        return {
          suggestions: items.map((item) => toMonacoCompletion(monaco, item)),
        };
      },
    },
  );
}

// --- diagnostics -----------------------------------------------------------

/**
 * Run the linter on a model whenever it changes (debounced) and publish the
 * results as Monaco markers. Returns a disposer that stops listening and clears
 * the markers.
 */
export function wireDiagnostics(
  monaco: Monaco,
  model: MonacoNS.editor.ITextModel,
  debounceMs = 400,
): MonacoNS.IDisposable {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    const diagnostics = await pretextMarkdownLanguage.getDiagnostics(
      model.getValue(),
    );
    monaco.editor.setModelMarkers(
      model,
      PRETEXT_MARKDOWN_LANGUAGE_ID,
      diagnostics.map((d) => toMonacoMarker(monaco, d)),
    );
  };

  const sub = model.onDidChangeContent(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  });

  void run(); // initial pass

  return {
    dispose() {
      if (timer) clearTimeout(timer);
      sub.dispose();
      monaco.editor.setModelMarkers(model, PRETEXT_MARKDOWN_LANGUAGE_ID, []);
    },
  };
}

// --- LSP → Monaco mapping --------------------------------------------------

type LspCompletionItem = ReturnType<
  typeof pretextMarkdownLanguage.getCompletions
>[number];
type LspDiagnostic = Awaited<
  ReturnType<typeof pretextMarkdownLanguage.getDiagnostics>
>[number];

function toMonacoCompletion(
  monaco: Monaco,
  item: LspCompletionItem,
): MonacoNS.languages.CompletionItem {
  const edit = item.textEdit!;
  const r = edit.range;
  const range = new monaco.Range(
    r.start.line + 1,
    r.start.character + 1,
    r.end.line + 1,
    r.end.character + 1,
  );
  const isSnippet = item.insertTextFormat === 2; // InsertTextFormat.Snippet
  return {
    label: typeof item.label === "string" ? item.label : item.label.label,
    kind: mapCompletionKind(monaco, item.kind),
    insertText: edit.newText,
    insertTextRules: isSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    range,
    detail: item.detail,
    documentation:
      item.documentation && typeof item.documentation === "object"
        ? { value: item.documentation.value }
        : (item.documentation as string | undefined),
    sortText: item.sortText,
  };
}

function mapCompletionKind(
  monaco: Monaco,
  kind: number | undefined,
): MonacoNS.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 7: // LSP Class
      return K.Class;
    case 9: // LSP Module
      return K.Module;
    case 3: // LSP Function
      return K.Function;
    case 18: // LSP Reference
      return K.Reference;
    case 14: // LSP Keyword
      return K.Keyword;
    default:
      return K.Text;
  }
}

function toMonacoMarker(
  monaco: Monaco,
  d: LspDiagnostic,
): MonacoNS.editor.IMarkerData {
  return {
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
    message: d.message,
    source: d.source,
    severity: mapSeverity(monaco, d.severity),
  };
}

function mapSeverity(
  monaco: Monaco,
  severity: number | undefined,
): MonacoNS.MarkerSeverity {
  const S = monaco.MarkerSeverity;
  switch (severity) {
    case 1: // LSP Error
      return S.Error;
    case 2: // LSP Warning
      return S.Warning;
    case 4: // LSP Hint
      return S.Hint;
    default: // LSP Information
      return S.Info;
  }
}
