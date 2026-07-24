# Blueprint: LaTeX-style PreTeXt language support

Goal: code completions and validation for **LaTeX-style PreTeXt** (LaTeX syntax that converts to
PreTeXt via `@pretextbook/unified-latex-to-pretext`), delivered in both the VS Code extension and
the Monaco editor in pretext-plus-editor. Markdown-style support comes later; interfaces are
designed so it can slot in without touching the host adapters.

## Decisions already made

| Decision            | Choice                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Data source         | Curated macro/environment table maintained in pretext-tools (with a drift-guard test)                             |
| File identity       | New language id `pretext-latex`, filename pattern `*.ptx.tex`, plus opt-in takeover of `.tex` in PreTeXt projects |
| Validation depth v1 | Parse-level: unmatched `\begin`/`\end`, unknown environments, unknown macros                                      |
| Scope               | LaTeX-only implementation, markdown-aware host interfaces                                                         |
| Placement           | New workspace package `@pretextbook/latex-style-pretext`                                                      |
| v1 completions      | Env snippets with structure, macro completions, math-mode awareness, `\ref`/`\label` intelligence                 |

## Architecture overview

```
                      ┌────────────────────────────────────────┐
                      │  @pretextbook/latex-style-pretext (new)│
                      │  data/   curated env + macro specs     │
                      │  scan/   lightweight doc scanner       │
                      │  completions/  getLatexCompletions     │
                      │  lint/   getLatexDiagnostics           │
                      └───────┬────────────────────┬───────────┘
                              │                    │
              VS Code LSP server            pretext-plus-editor
              (routes by languageId)        (Monaco providers, direct import —
                                             same pattern as pretextCompletions.ts)
```

The package follows the `@pretextbook/completions` precedent exactly:

- **No build step** — `main`/`types` point at `src/index.ts` raw TypeScript. Both consumers
  compile TS themselves (esbuild in the LSP server bundle, Vite in pretext-plus-editor).
- **LSP-shaped return types** (`CompletionItem`, `Diagnostic` from `vscode-languageserver-types`,
  which is browser-safe). pretext-plus already maps LSP completion items to Monaco in
  `pretextCompletions.ts`; diagnostics map to `monaco.editor.setModelMarkers`.
- **Published to npm** so pretext-plus-editor (separate repo) can consume it.

### Two engines, two parsing strategies

- **Completions** use a purpose-built lightweight scanner (`scan/`) — no unified-latex
  dependency. Completion requests are hot-path and only need local context: am I in math mode,
  what env am I inside, what's the `\`-prefix, what labels exist. A single linear scan
  (cached per document version) provides all of this.
- **Lint** uses the real `@unified-latex/unified-latex-util-parse` parser (error-tolerant,
  position-preserving). Walking a real AST avoids false positives in comments and verbatim
  content that regex approaches suffer from. Lint runs debounced (LSP: on content change like
  the existing RNG validation; Monaco: debounced `onDidChangeModelContent`). unified-latex is
  already shipped in pretext-plus for the import feature, so browser bundle cost is sunk;
  lazy-import it in the lint module anyway so completions-only consumers stay light.

## Package: `@pretextbook/latex-style-pretext`

```
packages/latex-style-pretext/
  package.json                # main/types -> src/index.ts (no build), publishable
  src/
    index.ts
    types.ts                  # EnvironmentSpec, MacroSpec, PretextFlavorLanguage
    data/
      environments.ts         # curated environment specs (canonical + aliases)
      macros.ts               # curated text-mode macro specs
      math.ts                 # math environments + KaTeX-supported math macros
    scan/
      scan-document.ts        # linear scanner: math regions, env stack, labels, comments
      scan-document.spec.ts
    completions/
      get-completions.ts      # (text, offset) -> CompletionItem[]
      snippets.ts             # snippet generation from EnvironmentSpec/MacroSpec
      get-completions.spec.ts
    lint/
      get-diagnostics.ts      # (text) -> Diagnostic[]  (async; lazy-imports unified-latex)
      get-diagnostics.spec.ts
```

### Data model

```ts
export interface EnvironmentSpec {
  /** Environment name as typed in LaTeX; also the canonical PreTeXt element for most */
  name: string;
  /** Accepted shorthand names, e.g. theorem: ["thm", "theo", "thrm", ...] */
  aliases: string[];
  /** Converter wraps body in <statement> and hoists proof/hint/answer/solution as siblings */
  requiresStatement: boolean;
  /** Whether the env accepts an optional [title] argument */
  titleArg: boolean;
  /** Drives sorting, icons, and which snippets offer nested structure */
  kind: "block" | "structural" | "list" | "display" | "verbatim";
  /** Envs meaningful inside this one (proof, hint, answer, solution, task, ...) */
  childEnvironments?: string[];
  /** Override the auto-generated snippet body when the default shape isn't right */
  snippet?: string;
  documentation?: string;
}

export interface MacroSpec {
  name: string; // without backslash
  /** unified-latex style signature: "m" = mandatory, "o" = optional, e.g. "\href" = "m m" */
  signature: string;
  mode: "text" | "math" | "both";
  snippet?: string;
  documentation?: string;
}
```

**Seeding the tables.** Copy the current support surface out of the unified-latex fork
(`/files/GitHub/dev/unified-latex`, `packages/unified-latex-to-pretext`): the spec-driven block
environments with aliases and `requiresStatement` flags (theorem/thm/…, definition/defn/…,
hint, solution, …), the ~37 structural `envFactory` environments (figure, sidebyside,
exercises, objectives, …), the ~120 text macros (`\term`, `\fillin`, `\url`, `\ref`, …), and the
KaTeX-supported math macro list. Each data file carries a header comment pointing at the source
file in the fork so future curation has a known upstream.

**Drift guard.** Because the table is hand-curated, add a spec
(`data/converter-drift.spec.ts`) that imports the in-repo `@pretextbook/latex-pretext` converter
and, for every curated environment and macro, converts a minimal usage and asserts the converter
did not emit an "unknown/unsupported" warning. This turns silent drift between the curated table
and the converter into a red test, without making the converter a runtime dependency.

### Host-facing interface (the markdown-awareness seam)

```ts
export interface PretextFlavorLanguage {
  languageId: string; // "pretext-latex"; later "pretext-markdown"
  getCompletions(params: {
    text: string;
    offset: number;
    triggerCharacter?: string;
  }): CompletionItem[];
  getDiagnostics(text: string): Promise<Diagnostic[]>;
}
export const pretextLatexLanguage: PretextFlavorLanguage;
```

Both hosts program against this interface. When markdown-style lands, it ships a
`pretextMarkdownLanguage` implementing the same shape, and the adapters just register a second
entry — no adapter rework.

## Completion engine behavior

Trigger characters: `\`, `{`, `[`.

| Context (from scanner)                 | Completions offered                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `\` in text mode                       | Text/both-mode macros with argument placeholders; `\begin{…}` as a snippet entry                                                                                                                                                                                                                                |
| `\` in math mode                       | KaTeX-supported math macros only; env/structure completions suppressed                                                                                                                                                                                                                                          |
| `\begin{` prefix                       | All environments incl. aliases (alias items show "alias of theorem" as detail). Insert = full skeleton with matching `\end{}`; `titleArg` envs get a tab-stopped `[${1:title}]`; `requiresStatement` envs get a body placeholder plus, where meaningful, commented hints for `proof`/`hint`/`solution` siblings |
| `\end{` prefix                         | Single item closing the innermost open environment (from the scanner's env stack)                                                                                                                                                                                                                               |
| `\ref{`, `\eqref{`, `\cref{`, `\Cref{` | Labels harvested from `\label{…}` in the document (cross-file project scan is a later phase)                                                                                                                                                                                                                    |
| Inside comment or verbatim             | No completions                                                                                                                                                                                                                                                                                                  |

Snippets are **generated** from the spec (`snippets.ts`) rather than hand-written per
environment, with `EnvironmentSpec.snippet` as an escape hatch for the handful of shapes that
need custom bodies (`tabular`, `sidebyside`, `list`).

## Lint checks (v1)

All diagnostics carry precise ranges from unified-latex AST positions.

1. **Unmatched environments** — `\begin{X}` without `\end{X}` and vice versa (unified-latex
   surfaces these as malformed nodes/parse messages; walk and report). Severity: Error.
2. **Unknown environment** — env name not in curated table ∪ math environments. Message:
   _"Environment 'X' is not supported by the PreTeXt conversion and will not convert."_
   Severity: Warning.
3. **Unknown macro** — macro not in curated macros (∪ KaTeX list when inside math). Severity:
   Information (configurable), since prose containing `\` is rarer but custom macros are a
   legitimate future feature; keep the noise floor low.
4. _(Stretch)_ Duplicate `\label`, and `\ref` to a nonexistent label — cheap once the label scan
   exists.

Skip diagnostics entirely inside verbatim environments (`code`, `program`, `console`, `sage`,
listings content) — the AST makes these easy to identify.

## VS Code integration (`packages/vscode-extension`)

1. **Language contribution** in `package.json`:
   ```jsonc
   {
     "id": "pretext-latex",
     "aliases": ["PreTeXt (LaTeX)"],
     "filenamePatterns": ["*.ptx.tex"],
     "configuration": "./language-configuration-latex.json",
   }
   ```
   `language-configuration-latex.json`: `%` line comments, bracket pairs incl. `$`
   auto-closing, `\begin`/`\end` folding markers.
2. **Grammar**: contribute `syntaxes/pretext-latex.tmLanguage.json` with scope
   `text.tex.latex.pretext` whose top-level pattern is `{ "include": "text.tex.latex" }` —
   reusing VS Code's builtin latex-basics grammar (present in every VS Code install) without
   vendoring it. Later, injection rules can highlight PreTeXt-specific macros distinctly.
3. **LSP routing**: add `{ scheme: "file", language: "pretext-latex" }` to the client
   `documentSelector` (`lsp-client/main.ts:69`). In the server, branch on
   `TextDocument.languageId`: `pretext` → existing schema-driven engine; `pretext-latex` →
   `pretextLatexLanguage` from the new package, for both `onCompletion` and the validation
   pipeline. Add `\`, `{`, `[` to the server's registered trigger characters (scoped per
   language via the completion handler, since trigger registration is global).
4. **Opt-in `.tex` takeover**: setting `pretext-tools.latexPretext.treatTexAsPretext`
   (default `false`). When enabled _and_ the workspace contains `project.ptx`, an
   `onDidOpenTextDocument` listener calls `vscode.languages.setTextDocumentLanguage(doc,
"pretext-latex")` for `latex`-language documents. Default-off avoids fighting LaTeX
   Workshop; docs mention `files.associations` as the manual alternative.
5. **Snippets/commands**: none needed in v1 beyond what the completion engine provides.

## pretext-plus-editor integration (separate repo)

1. **Register the language** (new `editorConfigs/latexSyntax.ts`, mirroring
   `markdownSyntax.ts`): `monaco.languages.register({ id: "pretext-latex" })` plus a Monarch
   tokenizer — Monaco's basic-languages does not include LaTeX, so the current
   `latexConfig.ts` (`language: "latex"`) silently falls back to plaintext today. A modest
   Monarch grammar covering comments, `\macro`, `\begin`/`\end` names, math delimiters, and
   braces is sufficient and fixes highlighting as a side benefit.
2. **Completions** (new `editorConfigs/latexCompletions.ts`): register a
   `CompletionItemProvider` for `pretext-latex` with trigger characters `\`, `{`, `[`,
   delegating to `pretextLatexLanguage.getCompletions` and reusing the existing LSP→Monaco
   mapping helpers from `pretextCompletions.ts` (extract them to a shared module).
3. **Diagnostics**: debounced (≈500 ms) `onDidChangeModelContent` →
   `pretextLatexLanguage.getDiagnostics` → `monaco.editor.setModelMarkers(model,
"pretext-latex", markers)`.
4. **Wire up** `latexConfig.ts` to `language: "pretext-latex"` and the new registrations, so
   any surface using `FormatEditorConfig` for latex documents picks everything up.
5. **Dependency**: consume `@pretextbook/latex-style-pretext` from npm; during development use a
   `file:` link to the pretext-tools workspace.

## Implementation phases

Each phase is landable and testable on its own.

1. **Phase 1 — data + scanner** (pretext-tools): create the package, seed
   `data/` from the fork's tables, build `scan-document.ts` (math regions, env stack, labels,
   comments/verbatim), specs for both. Wire into `test:libraries`. — ✅ **Done** (`packages/latex-style-pretext`, 24 specs green).
2. **Phase 2 — completions**: `get-completions.ts` + `snippets.ts` + specs covering every
   context row in the table above. — ✅ **Done**.
3. **Phase 3 — lint**: `get-diagnostics.ts` with the three v1 checks + specs; add the
   converter drift-guard spec. — ✅ **Done** (scanner-based, not unified-latex — see note below);
   drift-guard spec still TODO.

**Demo (ahead of Phases 4–5):** a Monaco-based demo page lives in the `playground` package
(`latex-demo.html`, `src/latex-demo.ts`, `src/monaco-latex.ts`). Run `npm run dev -w
@pretextbook/playground` and open the "LaTeX Language Demo" link. `src/monaco-latex.ts` is the
reference adapter pretext-plus-editor should mirror: `registerPretextLatex(monaco)` (language +
tokenizer + completion provider) and `wireDiagnostics(monaco, model)` (debounced markers).

**Lint deviation:** v1 lint is scanner-based rather than unified-latex-AST-based. The scanner
already suppresses comments/verbatim/math correctly, which covers the main false-positive
sources, and it keeps the browser bundle free of unified-latex. The data tables had to grow to
cover macros the converter handles *natively* (division macros `\section`/`\chapter`, document
macros `\documentclass`/`\title`, streaming font commands, exam item macros) — these are NOT in
the `macroReplacements` table. Unknown-macro is Information severity and also honors in-document
`\newcommand`/`\def` definitions. Revisit unified-latex for lint if false-positive reports
appear.
4. **Phase 4 — VS Code wiring**: language/grammar contributions, LSP routing, `.tex` opt-in
   setting; integration test (`.ptx.tex` fixture opens with `pretext-latex` languageId and gets
   completions/diagnostics through the LSP).
5. **Phase 5 — publish + pretext-plus**: publish `@pretextbook/latex-style-pretext`; in
   pretext-plus-editor add tokenizer, providers, markers, and `latexConfig` wiring.
6. **Phase 6 (later) — polish & markdown prep**: hover docs from `documentation` fields,
   cross-file label completion, configurable severities, then `pretext-markdown` as the second
   `PretextFlavorLanguage`.

## Risks and mitigations

- **Curated table drift** from the converter → drift-guard spec fails in CI when the converter
  gains/loses support.
- **Grammar include** depends on VS Code's builtin `text.tex.latex` scope — present in all
  standard builds; Monaco path doesn't rely on it (Monarch instead).
- **`.tex` takeover** could surprise LaTeX Workshop users → default off, gated on
  `project.ptx` presence, documented.
- **Browser bundle weight** for lint → unified-latex already ships in pretext-plus (import
  feature); lazy `import()` inside the lint module keeps completion-only paths light.
- **Release choreography** across two repos → pretext-plus work starts only after Phase 5's
  npm publish; `file:` linking covers development.
