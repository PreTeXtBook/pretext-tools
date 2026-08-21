// The cleaning rule table for legacy LaTeX, ported from
// `@pretextbook/import`'s `lib/clean/latex-data.ts`, which in turn ports
// davidfarmer/PreprocessLaTeX's `data.js`.
//
// Upstream's six differently-shaped exports (`badEverywhereMacros`,
// `badEverywhereMacrosLine`, `badEverywhereMacrosPlus`, `publisherOptions`,
// `eliminateAndSave`, `badBodyEnvironments`) encoded behavior in their *shape*,
// with the dispatch spread across `scanForAnomalies`. Here behavior is data: one
// ordered list of `CleanRule`s that `findLatexFixes` walks.
//
// Order is significant. It reproduces `scanForAnomalies`'s group order, and
// `applyLatexFixes` resolves overlaps in favour of the earlier rule — so a
// whole-line deletion beats a bare-macro deletion inside that same line.
//
// Upstream typos ("textss", "testsl") are preserved deliberately so behavior
// matches PreprocessLaTeX; see the fidelity tests in `rules.spec.ts`.

/** Why a rule exists — drives the wording of the report the author sees. */
export type CleanRuleKind =
  | "unused"
  | "presentation"
  | "accessibility"
  | "mistake"
  | "archaic"
  | "publisher"
  | "other";

export type CleanSeverity = "info" | "warning" | "error";

/**
 * What a rule does when it matches.
 *
 * - `delete` — remove the matched text.
 * - `replace` — swap it for `replacement` (`$1`-style backreferences allowed).
 * - `flag` — report it and change nothing. The author has to decide.
 */
export type CleanAction = "delete" | "replace" | "flag";

/** Scan regions a rule declines to fire inside. */
export type ProtectedRegionKind = "math" | "comment" | "verbatim";

/**
 * How a rule finds its occurrences.
 *
 * - `macro` with `form: "bare"` — the control word alone (`\smallskip`).
 * - `macro` with `form: "line"` — the control word through end of line, for
 *   directives whose whole line is noise (`\setlength{\parindent}{0pt}`).
 * - `macro` with `form: "args"` — the control word plus `arity` braced groups,
 *   so the argument goes with it (`\hspace{1cm}`).
 * - `environment` — both `\begin{name}` and `\end{name}`, leaving the body.
 * - `regex` — an explicit pattern, for the handful of rewrites that are not
 *   macro-shaped. Must be sticky-safe: `findLatexFixes` adds the `g` flag.
 */
export type CleanMatcher =
  | {
      type: "macro";
      name: string;
      form: "bare" | "line" | "args";
      arity?: number;
    }
  | { type: "environment"; name: string }
  | { type: "regex"; pattern: RegExp };

export interface CleanRule {
  /** Stable id — used to disable a rule and to key its code action. */
  id: string;
  /**
   * What to call the thing this rule matches, when the id is not it. A regex
   * rule has no macro name to fall back on, and `{\bf …}` should read as `bf`
   * rather than `tex-font-bf` in a change report.
   */
  label?: string;
  /** How to describe the replacement in a report, when the raw text reads badly. */
  replacementLabel?: string;
  kind: CleanRuleKind;
  category: string;
  /** Which part of a document the rule may fire in. */
  scope: "preamble" | "body" | "anywhere";
  match: CleanMatcher;
  action: CleanAction;
  /** For `replace`. `$1`, `$2`, … refer to the matcher's capture groups. */
  replacement?: string;
  severity: CleanSeverity;
  message?: string;
  /**
   * Report the matched text verbatim in the author's change report, not just a
   * count. Upstream's `eliminateAndSave`: the macro goes away, but the author
   * needs to see what was in it to reconstruct the intent.
   */
  reportMatch?: boolean;
  /** Regions to skip. Defaults to comments and verbatim bodies. */
  skipIn?: ProtectedRegionKind[];
  /**
   * Semantic macros to offer in place of this one. Only meaningful on a `flag`
   * rule: the rule cannot decide, so the editor offers the choice. These never
   * take part in a bulk clean-up — picking one is an editorial act.
   */
  alternatives?: MacroAlternative[];
}

/** Human-readable gloss for a rule kind, from upstream's `typeOfError`. */
export const KIND_DESCRIPTIONS: Record<string, string> = {
  unused: "LaTeX-specific markup",
  presentation: "Presentation does not go into PreTeXt source",
  accessibility: "Accessibility issue",
  mistake: "This feature should not have been added to LaTeX",
  archaic: "plain TeX that should not be in LaTeX source",
};

/**
 * A semantic macro to offer in place of a presentational one.
 *
 * `\textbf` says "make this bold", which is a statement about appearance. PreTeXt
 * wants to know *why* it is bold — is it a warning, a defined term, ordinary
 * emphasis? Only the author knows, so these become a menu of quick fixes rather
 * than an automatic rewrite.
 */
export interface MacroAlternative {
  /** Macro to substitute, without the backslash. */
  macro: string;
  /** What choosing it would mean, for the action title. */
  meaning: string;
}

/**
 * Semantic replacements for each presentational font macro, best-guess first.
 *
 * Ordering matters: the first entry is what the editor lists at the top, so it
 * should be the reading that is right most often. Bold most often means alert;
 * italic most often means ordinary emphasis; small caps most often marks an
 * initialism.
 */
export const MACRO_ALTERNATIVES: Record<string, MacroAlternative[]> = {
  textbf: [
    { macro: "alert", meaning: "something the reader must not miss" },
    { macro: "term", meaning: "a term being defined" },
    { macro: "emph", meaning: "ordinary emphasis" },
  ],
  textit: [
    { macro: "emph", meaning: "ordinary emphasis" },
    { macro: "term", meaning: "a term being defined" },
    { macro: "foreign", meaning: "a word from another language" },
    { macro: "alert", meaning: "something the reader must not miss" },
  ],
  texttt: [
    { macro: "code", meaning: "code or a literal value" },
    { macro: "kbd", meaning: "a key the reader presses" },
  ],
  textsc: [
    { macro: "init", meaning: "an initialism read letter by letter" },
    { macro: "acro", meaning: "an acronym read as a word" },
    { macro: "term", meaning: "a term being defined" },
  ],
  textrm: [{ macro: "emph", meaning: "ordinary emphasis" }],
};

// ---------------------------------------------------------------------------
// Table builders
// ---------------------------------------------------------------------------

interface BulkOptions {
  kind: CleanRuleKind;
  category: string;
  scope?: CleanRule["scope"];
  action?: CleanAction;
  severity?: CleanSeverity;
  form?: "bare" | "line" | "args";
  message?: string;
  reportMatch?: boolean;
  idPrefix?: string;
}

/** One rule per macro name, sharing a kind/category/behavior. */
function macroRules(names: string[], options: BulkOptions): CleanRule[] {
  const {
    kind,
    category,
    scope = "anywhere",
    action = "delete",
    severity = "info",
    form = "bare",
    message,
    reportMatch,
    idPrefix = "",
  } = options;
  return names.map((name) => ({
    id: `${idPrefix}${name}`,
    kind,
    category,
    scope,
    match: { type: "macro" as const, name, form },
    action,
    severity,
    message,
    reportMatch,
  }));
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * Rewrites that must run before anything else, from upstream's
 * `specialPreprocess` and `fixPlainTeX`. They are `replace` rules, so the
 * fixpoint loop in `applyAllLatexFixes` re-runs the table over their output —
 * which is how `{\bf …}` becomes `\textbf{…}` and is then flagged as a
 * presentational font macro, the same two-step upstream got from running
 * `fixPlainTeX` twice.
 */
export const REWRITE_RULES: CleanRule[] = [
  {
    id: "paren-ref",
    label: "(\\ref{...})",
    replacementLabel: "\\eqref{...}",
    kind: "presentation",
    category: "math_refs",
    scope: "anywhere",
    match: { type: "regex", pattern: /\(\\ref\{([^{}]+)\}\)/ },
    action: "replace",
    replacement: "\\eqref{$1}",
    severity: "info",
    message:
      "A parenthesized \\ref is an equation reference; \\eqref carries that meaning.",
  },
  {
    // Upstream collapsed `\vfill` → `\vfil`, then chains of `\vfil`, then
    // rewrote what was left — three passes to reach one `\vspace{1in}`. One
    // pattern gets there directly.
    id: "vfil-chain",
    label: "vfil",
    replacementLabel: "\\vspace{1in}",
    kind: "presentation",
    category: "spacing_vertical",
    scope: "anywhere",
    match: { type: "regex", pattern: /\\vfill?\b(\s*\\vfill?\b)*/ },
    action: "replace",
    replacement: "\\vspace{1in}",
    severity: "info",
    message: "Vertical fill is presentational; PreTeXt handles page layout.",
  },
  {
    id: "underline-blank",
    label: "\\underline{}",
    replacementLabel: "\\fillin",
    kind: "presentation",
    category: "blanks",
    scope: "anywhere",
    match: { type: "regex", pattern: /\\underline\{\s*\}/ },
    action: "replace",
    replacement: "\\fillin",
    severity: "info",
    message:
      "An empty \\underline{} is a common hack for a fill-in-the-blank; \\fillin is the semantic PreTeXt equivalent.",
  },
  {
    id: "vskip",
    label: "vskip",
    replacementLabel: "\\vspace{...}",
    kind: "presentation",
    category: "spacing_vertical",
    scope: "anywhere",
    match: { type: "regex", pattern: /\\vskip\*? *([0-9]+|-) *([a-zA-Z]+).*/ },
    action: "replace",
    replacement: "\\vspace{$1$2}",
    severity: "info",
  },
  {
    id: "vspace-star",
    label: "vspace",
    replacementLabel: "\\vspace{...}",
    kind: "presentation",
    category: "spacing_vertical",
    scope: "anywhere",
    match: {
      type: "regex",
      pattern: /\\vspace\*? *\{ *([0-9]+|-) *([a-zA-Z]+)[^{}]*?\}/,
    },
    action: "replace",
    replacement: "\\vspace{$1$2}",
    severity: "info",
  },
];

/**
 * Plain-TeX font directives: `{\bf foo}` → `\textbf{foo`. The match deliberately
 * consumes the opening brace and the replacement re-opens one, so the source's
 * own closing brace ends up closing the new macro.
 */
export const FONT_DIRECTIVE_PAIRS: Array<{ from: string; to: string }> = [
  { from: "rm", to: "textrm" },
  { from: "em", to: "emph" },
  { from: "it", to: "textit" },
  { from: "itshape", to: "textit" },
  { from: "bf", to: "textbf" },
  { from: "bfseries", to: "textbf" },
  { from: "sf", to: "textsf" },
  // Upstream typos, preserved so behavior matches PreprocessLaTeX.
  { from: "sffamily", to: "textss" },
  { from: "textsl", to: "testsl" },
];

export const FONT_DIRECTIVE_RULES: CleanRule[] = FONT_DIRECTIVE_PAIRS.map(
  ({ from, to }) => ({
    id: `tex-font-${from}`,
    label: from,
    replacementLabel: to,
    kind: "presentation",
    category: "tex_fonts",
    scope: "anywhere",
    match: {
      type: "regex" as const,
      pattern: new RegExp(`\\{ *\\\\${from}\\b *`),
    },
    action: "replace" as const,
    replacement: `\\${to}{`,
    severity: "info" as const,
    message: `{\\${from} …} is a plain-TeX font directive; \\${to}{…} is its LaTeX form.`,
  }),
);

/** Deletions and flags, in upstream `scanForAnomalies` group order. */
export const ANOMALY_RULES: CleanRule[] = [
  // --- badEverywhereMacros: bare control words, deleted wherever they appear.
  ...macroRules(["if", "fi", "iffalse", "then", "else", "loop", "repeat"], {
    kind: "unused",
    category: "conditionals",
  }),
  ...macroRules(
    [
      "tiny",
      "scriptsize",
      "footnotesize",
      "small",
      "normalsize",
      "large",
      "Large",
      "LARGE",
      "huge",
      "Huge",
      "normalfont",
    ],
    { kind: "presentation", category: "font_size" },
  ),
  // `vfil`/`vfill` are unreachable here: the `vfil-chain` rewrite above always
  // claims them first. They are kept because upstream's table listed them, and
  // dropping them would be a silent divergence from PreprocessLaTeX's data.
  ...macroRules(["smallskip", "medskip", "bigskip", "vfil", "vfill"], {
    kind: "presentation",
    category: "spacing_vertical",
  }),
  ...macroRules(["centerline", "centering", "noindent", "par", "linebreak"], {
    kind: "presentation",
    category: "archaic_tex",
  }),
  ...macroRules(["ensuremath"], { kind: "mistake", category: "nonstructural" }),
  ...macroRules(
    [
      "relax",
      "makeatletter",
      "makeatother",
      "csname",
      "endcsname",
      "shipout",
      "noexpand",
      "expandafter",
      "clearpage",
    ],
    { kind: "archaic", category: "low_level_tex" },
  ),
  ...macroRules(
    [
      "newwrite",
      "newread",
      "immediate",
      "write",
      "write18",
      "read",
      "readline",
      "readfile",
      "openin",
      "openout",
      "jobname",
    ],
    { kind: "archaic", category: "file_manipulation" },
  ),

  // --- specialBadMacros: whole line goes, but the author is shown what it was.
  ...macroRules(["renewcommand"], {
    kind: "accessibility",
    category: "consistency",
    form: "line",
    severity: "warning",
    reportMatch: true,
    message:
      "Redefining an existing command changes meaning globally; PreTeXt has no equivalent.",
  }),

  // --- eliminateAndSave: plain-TeX definition primitives.
  ...macroRules(["def", "let", "edef", "gdef", "xdef", "global", "long"], {
    kind: "archaic",
    category: "use_newcommand_only",
    form: "line",
    severity: "warning",
    reportMatch: true,
    message: "Use \\newcommand instead; plain-TeX definitions do not convert.",
  }),

  // --- badEverywhereMacrosPlus: macro plus its braced arguments.
  {
    id: "hspace",
    kind: "presentation",
    category: "spacing_horizontal",
    scope: "anywhere",
    match: { type: "macro", name: "hspace", form: "args", arity: 1 },
    action: "delete",
    severity: "info",
    message: "Horizontal spacing is presentational.",
  },
  {
    id: "date",
    kind: "other",
    category: "other",
    scope: "anywhere",
    match: { type: "macro", name: "date", form: "args", arity: 1 },
    action: "delete",
    severity: "info",
  },
  ...(
    [
      ["color", 1],
      ["textcolor", 1],
      ["mathcolor", 1],
      ["definecolor", 3],
    ] as Array<[string, number]>
  ).map(
    ([name, arity]): CleanRule => ({
      id: name,
      kind: "accessibility",
      category: "colors",
      scope: "anywhere",
      match: { type: "macro", name, form: "args", arity },
      action: "delete",
      severity: "info",
      message:
        "Colour alone cannot carry meaning; use a PreTeXt element instead.",
    }),
  ),

  // --- badEverywhereMacrosLine.
  ...macroRules(["catcode", "newtheorem", "maketitle", "setlength"], {
    kind: "archaic",
    category: "low_level_tex",
    form: "line",
  }),

  // --- publisherOptions: decisions PreTeXt makes in the publication file.
  ...macroRules(
    [
      "theoremstyle",
      "makeindex",
      "allowdisplaybreaks",
      "frontmatter",
      "mainmatter",
      "appendix",
      "numberwithin",
      "setcounter",
      "tableofcontents",
      "FloatBarrier",
    ],
    {
      kind: "publisher",
      category: "zzzzz",
      form: "line",
      message: "this is a publisher choice in PreTeXt",
    },
  ),

  // --- badPlainTeX: flagged, never deleted — only the author knows what was
  // meant. Each carries a menu of semantic macros the editor offers instead.
  ...macroRules(["textrm", "textit", "textbf", "textsc", "texttt"], {
    kind: "presentation",
    category: "latex_fonts",
    scope: "body",
    action: "flag",
    severity: "warning",
  }).map((rule) => ({
    ...rule,
    alternatives: MACRO_ALTERNATIVES[rule.id],
  })),

  // --- badBodyEnvironments: the wrapper goes, the content stays.
  ...(["center", "minipage"] as const).map(
    (name): CleanRule => ({
      id: `env-${name}`,
      label: name,
      kind: "presentation",
      category: "nonstructural",
      scope: "body",
      match: { type: "environment", name },
      action: "delete",
      severity: "info",
    }),
  ),
];

/** Every rule, in application order. */
export const CLEAN_RULES: CleanRule[] = [
  ...REWRITE_RULES,
  ...FONT_DIRECTIVE_RULES,
  ...ANOMALY_RULES,
];

/** Look up a rule by id (for rebuilding a quick fix from a diagnostic). */
export function findRule(id: string): CleanRule | undefined {
  return CLEAN_RULES.find((rule) => rule.id === id);
}
