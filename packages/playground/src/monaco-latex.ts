// Monaco integration for LaTeX-style PreTeXt.
//
// This is the reference wiring for the `@pretextbook/latex-style-pretext`
// language core into a Monaco editor. pretext-plus-editor can copy this almost
// verbatim (its `editorConfigs/` modules already follow the same shape). The
// core is host-agnostic and returns LSP-shaped values; everything here is the
// thin adapter that maps those to Monaco's API.

import type * as MonacoNS from "monaco-editor";
import {
  pretextLatexLanguage,
  PRETEXT_LATEX_LANGUAGE_ID,
} from "@pretextbook/latex-style-pretext";

type Monaco = typeof MonacoNS;

/** Sample document shown in the demo; also handy for eyeballing behavior. */
export const SAMPLE_DOCUMENT = `\\documentclass{pretext}

\\begin{document}

\\section{Getting started}\\label{sec:intro}

A \\term{group} is a set with an operation. Try completions: type a
backslash, or \\begin{ inside the document.

\\begin{theorem}\\label{thm:main}
  Every finite group of prime order is cyclic.
\\end{theorem}

The proof is left to the reader; see \\cref{thm:main}.

Inline math works too: $x^2 + \\frac{1}{2}$. A wrong macro like
$\\notarealmacro$ is flagged.

% This whole line is a comment, so \\bogus is ignored here.

\\begin{itemize}
  \\item First
  \\item Second
\\end{itemize}

% Two intentional problems to see validation:
\\begin{bogusenv}
  This environment is not supported.
\\end{bogusenv}

\\begin{theorem}
  This theorem is never closed.

\\end{document}
`;

// --- language registration -------------------------------------------------

/**
 * Register the `pretext-latex` language: tokenizer (highlighting), bracket /
 * comment configuration, and a completion provider backed by the core. Safe to
 * call once at startup. Returns the disposable completion provider.
 */
export function registerPretextLatex(monaco: Monaco): MonacoNS.IDisposable {
  monaco.languages.register({
    id: PRETEXT_LATEX_LANGUAGE_ID,
    extensions: [".ptx.tex"],
    aliases: ["PreTeXt (LaTeX)"],
  });

  monaco.languages.setLanguageConfiguration(PRETEXT_LATEX_LANGUAGE_ID, {
    comments: { lineComment: "%" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "$", close: "$" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "$", close: "$" },
    ],
  });

  monaco.languages.setMonarchTokensProvider(PRETEXT_LATEX_LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/%.*$/, "comment"],
        [
          /\\(begin|end)(\{)([a-zA-Z0-9*-]*)(\})/,
          ["keyword", "delimiter.curly", "type", "delimiter.curly"],
        ],
        [/\\[a-zA-Z@]+/, "keyword"],
        [/\\[^a-zA-Z]/, "string.escape"],
        [/\$\$?/, "delimiter.math"],
        [/[{}[\]]/, "delimiter"],
      ],
    },
  });

  return monaco.languages.registerCompletionItemProvider(
    PRETEXT_LATEX_LANGUAGE_ID,
    {
      triggerCharacters: ["\\", "{", "["],
      provideCompletionItems(model, position, context) {
        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        const items = pretextLatexLanguage.getCompletions({
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
    const diagnostics = await pretextLatexLanguage.getDiagnostics(
      model.getValue(),
    );
    monaco.editor.setModelMarkers(
      model,
      PRETEXT_LATEX_LANGUAGE_ID,
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
      monaco.editor.setModelMarkers(model, PRETEXT_LATEX_LANGUAGE_ID, []);
    },
  };
}

// --- LSP → Monaco mapping --------------------------------------------------

type LspCompletionItem = ReturnType<
  typeof pretextLatexLanguage.getCompletions
>[number];
type LspDiagnostic = Awaited<
  ReturnType<typeof pretextLatexLanguage.getDiagnostics>
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
