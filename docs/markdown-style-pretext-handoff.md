# Handoff: building `@pretextbook/markdown-style-pretext`

You are creating a second "authoring flavor" language package — completions + validation for
**Markdown-style PreTeXt** — mirroring the just-completed
[`@pretextbook/latex-style-pretext`](../packages/latex-style-pretext). Read the LaTeX package's
blueprint first: [`docs/latex-style-pretext-blueprint.md`](./latex-style-pretext-blueprint.md).
This document tells you what to copy, what changes, and where the markdown source-of-truth lives.

## The one idea that makes this cheap

Both hosts (the VS Code LSP server and pretext-plus-editor's Monaco editor) program against a
single interface, `PretextFlavorLanguage`, defined in
[`packages/latex-style-pretext/src/types.ts`](../packages/latex-style-pretext/src/types.ts):

```ts
export interface PretextFlavorLanguage {
  languageId: string;
  getCompletions(params: GetCompletionsParams): CompletionItem[];
  getDiagnostics(text: string): Promise<Diagnostic[]>;
}
```

The LaTeX package exports `pretextLatexLanguage` implementing it. Your job is to export
`pretextMarkdownLanguage` implementing the _same_ shape. When you do, the host adapters register a
second entry and everything else — the Monaco demo, the eventual VS Code wiring — works with zero
changes to the adapters. **Do not invent a new interface; implement this one.**

Values are LSP-shaped (`vscode-languageserver-types`, browser-safe). The package ships raw
TypeScript with **no build step** (`main`/`types` → `src/index.ts`), exactly like
`@pretextbook/completions` and the LaTeX package. Both consumers transpile it themselves.

## What Markdown-style PreTeXt actually is

Markdown (CommonMark + GFM) plus **remark-directives** that carry the PreTeXt-specific
structure. The converter is [`@pretextbook/remark-pretext`](../packages/remark-pretext). Three
directive forms (from `remark-directive`):

| Form                        | Syntax                  | Example                            |
| --------------------------- | ----------------------- | ---------------------------------- |
| **container** directive     | `:::name` … `:::`       | `:::theorem` … `:::` → `<theorem>` |
| **leaf** directive          | `::name`                | `::image{source=...}`              |
| **text** (inline) directive | `:name[content]{attrs}` | `:term[group]` → `<term>`          |

Plus standard Markdown constructs (`#` headings → divisions, ` ``` ` fences → `<program>`/code,
`$…$`/`$$…$$` math, links, emphasis, lists) and YAML frontmatter.

There is also a *python* style syntax for container directives, for example
```
Theorem:
    Let $x$ be a real number. Then $x^2 \ge 0$.

    Proof:
        The square of any real number is nonnegative.

```

### Source of truth for your data tables

Mirror these (don't import the converter at runtime — copy into curated tables, like the LaTeX
package did):

- **Directives** → [`packages/remark-pretext/src/lib/directive-map.ts`](../packages/remark-pretext/src/lib/directive-map.ts):
  - `DIRECTIVE_SPEC_TABLE: Record<string, DirectiveSpec>` is the canonical list. `DirectiveSpec`
    has `type` (PreTeXt element), `category` (`theorem-like`, `proof-like`, `exercise-like`, …),
    `requiresStatement`, and `hasNestedTasks`. This is the direct analogue of the LaTeX
    `EnvironmentSpec` — `requiresStatement` means the same thing.
  - `getDirectiveSpec(name)`, `DIRECTIVE_MAP`, and `PROOF_SOLUTION_NAMES` are exported helpers
    worth reading for the semantics.
  - **Note on aliases:** the LaTeX table had shorthand aliases (`thm`→`theorem`); check whether
    the directive table has any. If it does, apply the decision already made for LaTeX — _aliases
    stay valid for validation but are NOT offered as completions_ (only canonical names are
    suggested). See `environmentBeginItems` in the LaTeX `get-completions.ts` for the pattern.
- **Math** → [`packages/remark-pretext/src/lib/math-parser.ts`](../packages/remark-pretext/src/lib/math-parser.ts):
  delimiters are `$$…$$`, `$…$`, `\[…\]`, `\(…\)` — **the same set the LaTeX scanner already
  handles.** Reuse the KaTeX support list: the LaTeX package vendored
  `src/data/katex-support.json` and exposes `KATEX_MACROS` / `isKnownMathMacro`. You can depend on
  `@pretextbook/latex-style-pretext` for the math data (or re-vendor). Prefer depending on it, so
  there is one KaTeX list.
- **Frontmatter / other constructs** →
  [`directive-normalizer.ts`](../packages/remark-pretext/src/lib/directive-normalizer.ts),
  [`frontmatter.ts`](../packages/remark-pretext/src/lib/frontmatter.ts),
  [`mdast-to-ptxast.ts`](../packages/remark-pretext/src/lib/mdast-to-ptxast.ts) (see the
  `containerDirective` / `leafDirective` handlers around lines 470–560).

## Copy almost verbatim from the LaTeX package

These carry over with only cosmetic changes:

| File                                 | Change needed                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                       | New name/description; same no-build layout; dep on `vscode-languageserver-types` (and optionally `@pretextbook/latex-style-pretext` for math data)                                                                                                                                                        |
| `tsconfig.json`, `tsconfig.lib.json` | Verbatim                                                                                                                                                                                                                                                                                                  |
| `vitest.config.mts`                  | Verbatim (`src/**/*.{spec,test}.ts`)                                                                                                                                                                                                                                                                      |
| `src/types.ts`                       | Reuse `PretextFlavorLanguage`, `GetCompletionsParams`, and the LSP-shaped item plumbing. Replace `EnvironmentSpec`/`MacroSpec` with markdown analogues (`DirectiveSpec`, and whatever inline-macro model you need). Consider importing the shared interface from the LaTeX package instead of redefining. |
| `src/util/position.ts`               | **Verbatim** (offset ↔ LSP Position; pure)                                                                                                                                                                                                                                                                |
| `src/language.ts`                    | Same shape; export `pretextMarkdownLanguage` + `PRETEXT_MARKDOWN_LANGUAGE_ID = "pretext-markdown"`                                                                                                                                                                                                        |
| `src/completions/get-completions.ts` | Same skeleton (regex the text before the cursor → dispatch by context → build `makeItem`s with `textEdit` ranges), **different contexts** (see below)                                                                                                                                                     |
| `src/completions/snippets.ts`        | Rewrite the insert-text builders for directive syntax                                                                                                                                                                                                                                                     |
| `src/lint/get-diagnostics.ts`        | Same three-check structure, adapted (see below)                                                                                                                                                                                                                                                           |

The `makeItem` helper, the auto-closed-bracket consumption trick, the `sortText` boosting, the
LSP→Monaco enum mapping conventions — all reusable ideas. Read the LaTeX versions before writing.

## What genuinely changes for Markdown

The scanner and the completion/lint _contexts_ are where the real work is. Markdown has no
`\begin{}`/`\macro`; it has directive fences, fenced code, and inline directives.

### Scanner (`src/scan/scan-document.ts`)

Write a markdown-aware single-pass scanner. It must expose (via a `contextAt(scan, offset)` like
the LaTeX one):

- **mode**: `text` vs `math` — math regions from `$…$`, `$$…$$`, `\[…\]`, `\(…\)`. _The LaTeX
  scanner's math-delimiter logic ports almost directly._
- **in fenced code** (` ``` ` / `~~~`) and **indented code** — the markdown analogue of
  "verbatim". Suppress completions and lint inside these, just like LaTeX verbatim.
- **directive stack**: which `:::container` directives are open at the cursor (for closing-fence
  and child-directive awareness — e.g. `solution` inside `exercise`). Track fence nesting by the
  number of colons (`:::` vs `::::`), which remark uses for nesting.
- **HTML-comment regions** (`<!-- … -->`) — markdown's comment form; suppress like LaTeX `%`.
- **labels / cross-reference targets**: how does the markdown flavor assign ids? Check
  `directive-normalizer.ts` / the directive attribute syntax (`{#id}` or `label=`), then harvest
  them for reference completion (the markdown analogue of `\ref`/`\label`).

Gotcha carried over from LaTeX: comment/verbatim detection is precedence-sensitive — a `:::` or
`$` inside a code fence or HTML comment must NOT be treated as a directive/math. Handle fenced
code and comments as "consume until close" states in the pass. The LaTeX scanner's verbatim
handling is the template.

### Completions (`src/completions/get-completions.ts`)

Contexts to detect from the text before the cursor:

| Context                          | Offer                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Start of line, `:::` typed       | Container directive names (canonical only), inserting `:::name` … `:::` skeleton                                                      |
| `:::` prefix partially typed     | Filter directives by prefix                                                                                                           |
| Inline `:` at a word boundary    | Text directives (`:term[…]`, …) — decide how aggressive to be; `:` is common in prose, so require a stricter trigger than LaTeX's `\` |
| Inside `$…$`                     | KaTeX math macros (reuse `KATEX_MACROS`); suppress directive/text completions                                                         |
| A cross-reference construct      | Harvested label ids                                                                                                                   |
| Inside code fence / HTML comment | Nothing                                                                                                                               |

The `:` trigger is the main UX risk — unlike `\`, a bare `:` appears constantly in normal text.
Be conservative: only trigger inline-directive completion when the `:` is at a directive-plausible
position (line start for containers/leaf; a stricter pattern for inline). Lean on Monaco's
`triggerCharacters` plus your own guard in `provideCompletionItems`.

### Lint (`src/lint/get-diagnostics.ts`)

Same v1 depth (parse-level), adapted:

1. **Unmatched directive fences** — an opened `:::` with no closing `:::` (Error). Fence matching
   is by colon count + nesting; simpler than LaTeX begin/end name matching but watch nesting.
2. **Unknown directive** — a directive name not in `DIRECTIVE_SPEC_TABLE` (Warning): "…is not a
   supported PreTeXt directive and will not convert."
3. **Unknown math macro** — inside math, validate against the KaTeX list (Information), reusing
   `isKnownMathMacro`.

Keep it scanner-based (no remark parse at runtime) for the same reasons as LaTeX: low browser
bundle weight, and the scanner already excludes code/comments (the main false-positive source).
The blueprint's note about revisiting a real parser applies equally here. **Markdown has no loose
`\macro` prose to police**, so you likely won't need an "unknown macro" text-mode check at all —
that removes the noisiest LaTeX check.

## Host wiring — already a reusable template

The Monaco adapter is done and generic. Look at
[`packages/playground/src/monaco-latex.ts`](../packages/playground/src/monaco-latex.ts):
`registerPretextLatex(monaco)` (language id + Monarch tokenizer + completion provider) and
`wireDiagnostics(monaco, model)` (debounced `setModelMarkers`). It is pure LSP→Monaco translation
with **zero language logic** — copy it to `monaco-markdown.ts`, swap the imported language object
and the Monarch tokenizer (markdown highlighting: headings, fences, `:::` directives, `$` math,
emphasis), and you have a demo.

Add a demo page mirroring `packages/playground/latex-demo.html` +
`src/latex-demo.ts`, register it in `packages/playground/vite.config.mts` (`input.markdownDemo`),
and link it from `index.html`. `monaco-editor` is already a playground dependency.

## Step-by-step

1. **Scaffold** `packages/markdown-style-pretext/` from the LaTeX package's config files. Add it to
   the root `test:libraries` script in `package.json` (next to `@pretextbook/latex-style-pretext`).
   Run `npm install` to register the workspace.
2. **Data** (`src/data/`): `directives.ts` (curate from `DIRECTIVE_SPEC_TABLE` with `kind`/child
   info as needed), reuse math data from the LaTeX package. Add a `data.spec.ts` sanity test.
3. **Scanner** (`src/scan/scan-document.ts`) + spec: math regions, fenced code, HTML comments,
   directive stack, labels. Port the LaTeX math/verbatim logic.
4. **Completions** (`src/completions/`) + spec: the contexts above.
5. **Lint** (`src/lint/`) + spec: the three checks above.
6. **`language.ts`**: export `pretextMarkdownLanguage` + `PRETEXT_MARKDOWN_LANGUAGE_ID`. Barrel it
   in `src/index.ts`.
7. **Demo**: `monaco-markdown.ts` + `markdown-demo.html` + `src/markdown-demo.ts`; wire Vite input
   and the index link.
8. **Drift-guard** (do this here, since LaTeX skipped it): a spec that runs each curated directive
   through `@pretextbook/remark-pretext` and asserts it converts without an "unsupported" warning.

## Verification

```sh
npm run test  -w @pretextbook/markdown-style-pretext   # unit specs
npm run build -w @pretextbook/markdown-style-pretext   # tsc type-check (no emit needed to consume)
npm run dev   -w @pretextbook/playground               # then open "Markdown Language Demo"
```

Run Prettier on changed files before finishing (project convention).

## Gotchas learned building the LaTeX package (they'll bite you too)

- **`@pretextbook/import` dist is gitignored and goes stale**, which breaks the _playground build_
  (not dev) with `"projectForImportMode" is not exported`. Fix: `npm run build -w
@pretextbook/import`. Unrelated to your code.
- **Comment suppression at end-of-line**: the LaTeX scanner needed an inclusive end check so a
  cursor sitting at the end of a comment counts as "in comment" (`offset > start && offset <=
end`). The markdown HTML-comment case has the same edge.
- **The source-of-truth table is bigger than the "replacement" table.** In LaTeX, division macros
  (`\section`) were handled _natively_ by the converter, not in the replacement table, so the
  curated data had to be widened to avoid false-positive lint. For markdown, check whether standard
  Markdown constructs (headings, fences, links) that the converter handles need any representation
  in your tables — probably not for lint (they aren't directives), but confirm.
- **The `:` trigger character** is the markdown-specific UX trap (see completions above). Budget
  time to tune it; it has no LaTeX analogue.
- **`getDiagnostics` is async** in the interface even though the implementation is sync — wrap in
  `async`/`Promise.resolve`, as the LaTeX package does, to keep the door open for a future parser.
- **Aliases decision** (if the directive table has any): valid for lint, not surfaced as
  completions. Already litigated for LaTeX — match it for consistency.

## Reference index

- LaTeX package (the model): [`packages/latex-style-pretext/`](../packages/latex-style-pretext)
- Blueprint & decisions: [`docs/latex-style-pretext-blueprint.md`](./latex-style-pretext-blueprint.md)
- Markdown converter (source of truth): [`packages/remark-pretext/`](../packages/remark-pretext)
- Monaco adapter template: [`packages/playground/src/monaco-latex.ts`](../packages/playground/src/monaco-latex.ts)
- Demo page template: `packages/playground/latex-demo.html`, `packages/playground/src/latex-demo.ts`
