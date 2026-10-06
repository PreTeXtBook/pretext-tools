/**
 * `theorem:` on a line of its own, then Enter, expands the `<theorem>`
 * snippet — and likewise for the other standard block environments.
 *
 * The snippet bodies are the ones PreTeXt completions offer
 * (`ELEMENTS` in `@pretextbook/completions`), so the expansion is exactly
 * what picking `<theorem>` from the completion list inserts.
 */
import { ELEMENTS } from "@pretextbook/completions";
import { NON_BLOCK_ELEMENTS } from "./elements";
import { resolveSelectedText } from "./snippets";
import { isWhitespace, lineEndOf, lineStartOf } from "./text";
import type { ShortcutEdit } from "./types";
import { isWithin, scanXmlContext } from "./xml-context";

/** The environments `name:` + Enter expands. */
export const ENVIRONMENT_NAMES: readonly string[] = [
  // theorem-like
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "claim",
  "fact",
  "identity",
  "algorithm",
  // axiom-like
  "axiom",
  "conjecture",
  "principle",
  "heuristic",
  "hypothesis",
  "assumption",
  // definition-like
  "definition",
  // remark-like
  "remark",
  "convention",
  "note",
  "observation",
  "warning",
  "insight",
  // computation-like
  "computation",
  "technology",
  // example-like
  "example",
  "problem",
  "question",
  // project-like
  "project",
  "activity",
  "exploration",
  "investigation",
  // proofs, exercises and their parts
  "proof",
  "exercise",
  "task",
  "hint",
  "answer",
  "solution",
  // asides and other blocks
  "aside",
  "biographical",
  "historical",
  "assemblage",
  "blockquote",
  "figure",
  "table",
];

const ENVIRONMENTS: ReadonlySet<string> = new Set(ENVIRONMENT_NAMES);

const NOT_HERE: ReadonlySet<string> = new Set([...NON_BLOCK_ELEMENTS, "p"]);

const TRIGGER = /^([ \t]*)([A-Za-z][\w-]*):[ \t]*$/;

/** The snippet for environment `name`, or `undefined` if it has none. */
export const environmentSnippet = (name: string): string | undefined => {
  if (!ENVIRONMENTS.has(name)) return undefined;
  const body = ELEMENTS[name]?.insertText;
  // Some bodies end in a newline; the author's own Enter already supplied one.
  // Nothing is selected when an environment is typed out.
  return typeof body === "string"
    ? resolveSelectedText(body.replace(/\n+$/, ""))
    : undefined;
};

/**
 * The expansion an Enter typed at `enterStart`–`enterEnd` triggers, if the
 * line it was typed on holds nothing but `name:` for a known environment, the
 * rest of that line is blank, and the line is outside any paragraph and
 * anywhere else a block can't go. Replaces `name:` and the Enter.
 */
export const environmentEdit = (
  source: string,
  enterStart: number,
  enterEnd: number,
): ShortcutEdit | null => {
  const lineStart = lineStartOf(source, enterStart);
  const match = TRIGGER.exec(source.slice(lineStart, enterStart));
  if (!match) return null;
  const snippet = environmentSnippet(match[2].toLowerCase());
  if (!snippet) return null;

  const end = lineEndOf(source, enterEnd);
  for (let i = enterEnd; i < end; i++) {
    if (!isWhitespace(source[i])) return null;
  }

  const start = lineStart + match[1].length;
  const context = scanXmlContext(source, start);
  if (!context.inText || isWithin(context, NOT_HERE)) return null;

  return { kind: "environment", start, end, text: snippet, snippet: true };
};
