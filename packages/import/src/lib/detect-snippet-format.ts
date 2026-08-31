/**
 * Format detection for a *snippet* — a pasted exercise, a copied paragraph —
 * as opposed to a whole file.
 *
 * `detectSourceFormat` answers a different question: given a file, is this a
 * LaTeX document? Its markers are document furniture — `\documentclass`,
 * `\begin{document}`, `\section` — none of which appear in the fragment someone
 * copies out of the middle of one. Asking it about `Let $G$ be a \emph{group}`
 * gets "pretext", because it recognises nothing and falls back.
 *
 * So this detector reads the grain of the markup instead: math delimiters,
 * backslash commands, list bullets, emphasis runs. It scores both languages and
 * takes the winner, provided the winner clears a floor — a single weak hint is
 * not enough, because guessing wrong mangles text the author meant to keep
 * verbatim. Declining is always safe; the caller falls back to a plain paste.
 */

/** Formats a snippet can be converted from. */
export type SnippetFormat = "latex" | "markdown";

/** A scoring rule: a pattern and what matching it is worth. */
interface Signal {
  pattern: RegExp;
  weight: number;
}

/**
 * Inline math, guarded against currency.
 *
 * `costs $5 and $7` would otherwise read as math delimiters wrapping " and ".
 * Requiring a TeX-ish character inside — a backslash, sub/superscript, or
 * braces — or else a lone variable like `$n$`, keeps prices out while still
 * catching the math people actually paste.
 */
const INLINE_MATH = /\$(?![\s$])([^$\n]{1,200})\$/;

function hasInlineMath(text: string): boolean {
  const match = INLINE_MATH.exec(text);
  if (!match) {
    return false;
  }
  const body = match[1];
  return /[\\^_{}]/.test(body) || /^[A-Za-z]'?$/.test(body.trim());
}

const LATEX_SIGNALS: Signal[] = [
  // \begin{...} / \end{...} — unambiguous.
  { pattern: /\\(?:begin|end)\{[a-zA-Z*]+\}/, weight: 3 },
  // Display math, either delimiter style.
  { pattern: /\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/, weight: 3 },
  // A command taking an argument: \emph{...}, \frac{...}{...}.
  { pattern: /\\[a-zA-Z]+\s*\{/, weight: 2 },
  // Inline math delimiters \( ... \).
  { pattern: /\\\([\s\S]*?\\\)/, weight: 2 },
  // A bare command: \alpha, \ldots, \\.
  { pattern: /\\[a-zA-Z]+\b/, weight: 1 },
  // Label/ref machinery is a strong hint even without braces nearby.
  { pattern: /\\(?:label|ref|eqref|cite)\b/, weight: 2 },
];

const MARKDOWN_SIGNALS: Signal[] = [
  // ATX heading.
  { pattern: /^#{1,6}\s+\S/m, weight: 3 },
  // Fenced code block.
  { pattern: /^\s*```/m, weight: 3 },
  // Bullet list.
  { pattern: /^\s*[-*+]\s+\S/m, weight: 2 },
  // Ordered list.
  { pattern: /^\s*\d+[.)]\s+\S/m, weight: 2 },
  // Strong emphasis.
  { pattern: /\*\*[^\s*][^*]*\*\*/, weight: 2 },
  // Inline link.
  { pattern: /\[[^\]\n]+\]\([^)\s]+\)/, weight: 2 },
  // Blockquote.
  { pattern: /^\s*>\s+\S/m, weight: 2 },
  // Underscore emphasis, bounded so snake_case_names do not count.
  { pattern: /(?:^|\s)_[^_\s][^_\n]*_(?:\s|[.,;:!?]|$)/, weight: 1 },
  // Inline code span.
  { pattern: /`[^`\n]+`/, weight: 1 },
];

/** Minimum score before a guess is worth acting on. */
const SCORE_FLOOR = 2;

function score(text: string, signals: Signal[]): number {
  return signals.reduce(
    (total, { pattern, weight }) => total + (pattern.test(text) ? weight : 0),
    0,
  );
}

export interface SnippetFormatScores {
  latex: number;
  markdown: number;
}

/** The raw scores, exposed so a host can explain a decision in a log. */
export function scoreSnippetFormats(text: string): SnippetFormatScores {
  const latex = score(text, LATEX_SIGNALS) + (hasInlineMath(text) ? 2 : 0);
  return { latex, markdown: score(text, MARKDOWN_SIGNALS) };
}

/**
 * Which converter a snippet warrants, or `undefined` to leave it alone.
 *
 * Ties go to LaTeX: the two languages overlap mainly on `*` and `_`, and in a
 * PreTeXt document the thing being pasted with a backslash or a dollar sign in
 * it is overwhelmingly TeX.
 */
export function detectSnippetFormat(text: string): SnippetFormat | undefined {
  const trimmed = text.trim();
  // Already markup — converting would be a round trip through two parsers.
  if (!trimmed || trimmed.startsWith("<")) {
    return undefined;
  }

  const { latex, markdown } = scoreSnippetFormats(trimmed);
  const best = Math.max(latex, markdown);
  if (best < SCORE_FLOOR) {
    return undefined;
  }
  return latex >= markdown ? "latex" : "markdown";
}
