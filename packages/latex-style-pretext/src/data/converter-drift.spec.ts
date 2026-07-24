import { describe, it, expect } from "vitest";
import { latexToPretext } from "@pretextbook/latex-pretext";
import { ENVIRONMENTS } from "./environments";
import { MACROS } from "./macros";
import type { MacroSpec } from "../types";

// Drift-guard: every curated environment (including aliases) and macro must
// still be recognized by the real converter. If support is renamed or removed
// in `@pretextbook/unified-latex-to-pretext`, converting our curated usage
// emits an `Unknown environment`/`Unknown macro` message, and this test fails
// — pointing at the exact entry to reconcile.

function unknownMessages(latex: string): string[] {
  const result = latexToPretext(latex);
  return result.messages
    .map((m) => m.message)
    .filter((m) => /^Unknown (environment|macro)/.test(m));
}

/** Wrap a body (and optional preamble) in a minimal complete document. */
function doc(preamble: string, body: string): string {
  return `\\documentclass{article}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}`;
}

/** Minimal LaTeX usage of an environment. */
function envUsage(name: string): string {
  // tabular is the only curated environment with a mandatory argument.
  if (name === "tabular") {
    return "\\begin{tabular}{cc}\na & b\\\\\n\\end{tabular}";
  }
  return `\\begin{${name}}\nx\n\\end{${name}}`;
}

/**
 * Macros the converter only handles in a specific context (document preamble,
 * a list, exam-class question lists, ...). A bare fragment usage would emit a
 * false "unknown macro" for these, so the drift check converts them in place.
 */
const CONTEXT_USAGE: Record<string, string> = {
  documentclass: doc("", "x"),
  usepackage: doc("\\usepackage{amsmath}", "x"),
  title: doc("\\title{T}", "x"),
  author: doc("\\author{A}", "x"),
  date: doc("\\date{D}", "x"),
  subtitle: doc("\\title{T}\\subtitle{S}", "x"),
  newcommand: doc("\\newcommand{\\foo}{bar}", "x"),
  renewcommand: doc("\\renewcommand{\\emph}{bar}", "x"),
  providecommand: doc("\\providecommand{\\foo}{bar}", "x"),
  item: "\\begin{itemize}\n\\item x\n\\end{itemize}",
  question: "\\begin{questions}\n\\question x\n\\end{questions}",
  subpart:
    "\\begin{questions}\n\\question x\n\\begin{parts}\n\\part y\n" +
    "\\begin{subparts}\n\\subpart z\n\\end{subparts}\n\\end{parts}\n\\end{questions}",
  subsubpart:
    "\\begin{questions}\n\\question x\n\\begin{parts}\n\\part y\n" +
    "\\begin{subparts}\n\\subpart z\n\\begin{subsubparts}\n\\subsubpart w\n" +
    "\\end{subsubparts}\n\\end{subparts}\n\\end{parts}\n\\end{questions}",
};

/**
 * Curated macros the converter does NOT yet convert (it emits an
 * unknown-macro TODO). They stay in the table on purpose: authors write them
 * in ordinary LaTeX documents, and lint flagging them as "unsupported" would
 * be noise — the converter passes them through visibly rather than silently
 * dropping content. The inverse check below fails when upstream gains support,
 * signalling the entry should be promoted out of this list.
 *
 * - centering, newline, input, paragraph: no replacement upstream (note
 *   subparagraph *is* handled; paragraph is not).
 * - maketitle, tableofcontents, frontmatter, mainmatter, backmatter:
 *   document-driver macros with no PreTeXt equivalent.
 * - scshape, normalfont: the streaming-command pass rewrites these to
 *   \textsc{}/plain content, but \textsc itself has no replacement.
 */
const KNOWN_UNCONVERTED = new Set([
  "centering",
  "newline",
  "input",
  "paragraph",
  "maketitle",
  "tableofcontents",
  "frontmatter",
  "mainmatter",
  "backmatter",
  "scshape",
  "normalfont",
]);

/** Minimal LaTeX usage of a macro, deriving arguments from its signature. */
function macroUsage(macro: MacroSpec): string {
  if (CONTEXT_USAGE[macro.name]) return CONTEXT_USAGE[macro.name];
  const args = macro.signature
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part === "o" ? "[x]" : "{x}"))
    .join("");
  return `\\${macro.name}${args} y`;
}

const ENV_NAMES = ENVIRONMENTS.flatMap((e) => [e.name, ...e.aliases]);

describe("curated environments match the converter", () => {
  it.each(ENV_NAMES)("%s converts without an unknown warning", (name) => {
    expect(unknownMessages(envUsage(name))).toEqual([]);
  });
});

const CONVERTED_MACROS = MACROS.filter((m) => !KNOWN_UNCONVERTED.has(m.name));

describe("curated macros match the converter", () => {
  it.each(CONVERTED_MACROS.map((m) => m.name))(
    "\\%s converts without an unknown warning",
    (name) => {
      const macro = CONVERTED_MACROS.find((m) => m.name === name)!;
      expect(unknownMessages(macroUsage(macro))).toEqual([]);
    },
  );

  it("KNOWN_UNCONVERTED names are all curated macros", () => {
    const curated = new Set(MACROS.map((m) => m.name));
    for (const name of KNOWN_UNCONVERTED) {
      expect(curated, `${name} is not in MACROS`).toContain(name);
    }
  });

  // Inverse guard: if one of these starts converting cleanly, upstream gained
  // support — remove it from KNOWN_UNCONVERTED so the main sweep covers it.
  it.each([...KNOWN_UNCONVERTED])(
    "\\%s is still unconverted upstream",
    (name) => {
      const macro = MACROS.find((m) => m.name === name)!;
      expect(unknownMessages(macroUsage(macro))).not.toEqual([]);
    },
  );
});
