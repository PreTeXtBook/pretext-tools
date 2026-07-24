// A lightweight, single-pass scanner over LaTeX-style PreTeXt source.
//
// It exists to answer local questions the completion engine needs cheaply and
// without a full parse: at a given offset, am I in math mode / a comment / a
// verbatim block, and what environments are open? It also harvests every
// `\label{...}` for `\ref` completion. Lint uses the real unified-latex parser
// instead (see ../lint); this scanner favours speed and never throws.

import { KATEX_ENVIRONMENTS } from "../data/math";

/** Environments whose body is raw text — no macro, math, or nested scanning. */
export const VERBATIM_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "code",
  "program",
  "console",
  "sage",
  "verbatim",
  "lstlisting",
  "minted",
]);

export interface Region {
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

export interface LabelInfo {
  name: string;
  /** Offset of the first character of the label name. */
  offset: number;
}

export interface EnvOccurrence {
  name: string;
  type: "begin" | "end";
  /** Offset of the opening backslash. */
  start: number;
  /** Offset just past the closing `}`. */
  end: number;
  isMath: boolean;
  isVerbatim: boolean;
}

export interface MacroOccurrence {
  /** Control-word name without the backslash (e.g. "term"). */
  name: string;
  /** Offset of the backslash. */
  start: number;
  /** Offset just past the last letter of the name. */
  end: number;
}

export interface DocumentScan {
  labels: LabelInfo[];
  /** Math regions delimited by `$`, `$$`, `\(…\)`, `\[…\]` (not env-based math). */
  mathRegions: Region[];
  /** `%` line comments. */
  commentRegions: Region[];
  environments: EnvOccurrence[];
  /**
   * Control-word macros (`\name`), excluding `\begin`/`\end`/`\label` which are
   * captured separately. Suppressed inside comments and verbatim bodies.
   */
  macros: MacroOccurrence[];
}

export interface ScanContext {
  mode: "text" | "math";
  inComment: boolean;
  inVerbatim: boolean;
  /** Open environments, innermost last. */
  envStack: string[];
  /** Innermost open environment, if any. */
  currentEnvironment?: string;
}

function isLetter(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

/** If `text` has `keyword` at `i`, return the index after it, else -1. */
function matchKeyword(text: string, i: number, keyword: string): number {
  return text.startsWith(keyword, i) ? i + keyword.length : -1;
}

/**
 * Read a `{...}` group starting at `text[open] === "{"`. Returns the inner
 * content and the index just past `}`, or null if unterminated.
 */
function readBraceGroup(
  text: string,
  open: number,
): { content: string; end: number } | null {
  if (text[open] !== "{") return null;
  const close = text.indexOf("}", open + 1);
  if (close === -1) return null;
  return { content: text.slice(open + 1, close), end: close + 1 };
}

/**
 * Match `\<name>{group}` at offset `i` (with optional spaces before `{`).
 * `name` is the control word without backslash, e.g. "begin".
 */
function matchControlWithGroup(
  text: string,
  i: number,
  name: string,
): { group: string; groupStart: number; end: number } | null {
  const afterWord = matchKeyword(text, i, "\\" + name);
  if (afterWord === -1) return null;
  // A control word must not be immediately followed by another letter
  // (so `\end` does not match `\endgroup`).
  if (isLetter(text[afterWord] ?? "")) return null;
  let j = afterWord;
  while (text[j] === " " || text[j] === "\t") j++;
  const group = readBraceGroup(text, j);
  if (!group) return null;
  return { group: group.content, groupStart: j + 1, end: group.end };
}

export function scanDocument(text: string): DocumentScan {
  const labels: LabelInfo[] = [];
  const mathRegions: Region[] = [];
  const commentRegions: Region[] = [];
  const environments: EnvOccurrence[] = [];
  const macros: MacroOccurrence[] = [];

  const n = text.length;
  let i = 0;
  let mathDelim: string | null = null; // expected closing token
  let mathStart = 0;
  let verbatimEnv: string | null = null; // set while inside a verbatim body

  const classify = (name: string) => ({
    isMath: KATEX_ENVIRONMENTS.has(name),
    isVerbatim: VERBATIM_ENVIRONMENTS.has(name),
  });

  while (i < n) {
    // Inside a verbatim body: everything is literal except the matching \end.
    if (verbatimEnv !== null) {
      const end = matchControlWithGroup(text, i, "end");
      if (end && end.group === verbatimEnv) {
        environments.push({
          name: end.group,
          type: "end",
          start: i,
          end: end.end,
          ...classify(end.group),
        });
        verbatimEnv = null;
        i = end.end;
      } else {
        i++;
      }
      continue;
    }

    const c = text[i];

    // Line comment: `%` to end of line (a preceding `\` is consumed below).
    if (c === "%") {
      const nl = text.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      commentRegions.push({ start: i, end });
      i = end;
      continue;
    }

    if (c === "\\") {
      // Math delimiters.
      if (text[i + 1] === "(") {
        if (mathDelim === null) {
          mathDelim = "\\)";
          mathStart = i;
        }
        i += 2;
        continue;
      }
      if (text[i + 1] === "[") {
        if (mathDelim === null) {
          mathDelim = "\\]";
          mathStart = i;
        }
        i += 2;
        continue;
      }
      if (text[i + 1] === ")" || text[i + 1] === "]") {
        const token = "\\" + text[i + 1];
        if (mathDelim === token) {
          mathRegions.push({ start: mathStart, end: i + 2 });
          mathDelim = null;
        }
        i += 2;
        continue;
      }
      // Line break `\\`.
      if (text[i + 1] === "\\") {
        i += 2;
        continue;
      }
      // Structural control words.
      const begin = matchControlWithGroup(text, i, "begin");
      if (begin) {
        const info = classify(begin.group);
        environments.push({
          name: begin.group,
          type: "begin",
          start: i,
          end: begin.end,
          ...info,
        });
        if (info.isVerbatim) verbatimEnv = begin.group;
        i = begin.end;
        continue;
      }
      const end = matchControlWithGroup(text, i, "end");
      if (end) {
        environments.push({
          name: end.group,
          type: "end",
          start: i,
          end: end.end,
          ...classify(end.group),
        });
        i = end.end;
        continue;
      }
      const label = matchControlWithGroup(text, i, "label");
      if (label) {
        labels.push({ name: label.group, offset: label.groupStart });
        i = label.end;
        continue;
      }
      // A control word `\word`: record it and skip the whole name.
      if (isLetter(text[i + 1] ?? "")) {
        let j = i + 1;
        while (j < n && isLetter(text[j])) j++;
        macros.push({ name: text.slice(i + 1, j), start: i, end: j });
        i = j;
        continue;
      }
      // An escaped single character: `\%`, `\$`, `\{`, `\&`, ...
      i += 2;
      continue;
    }

    if (c === "$") {
      const isDouble = text[i + 1] === "$";
      const token = isDouble ? "$$" : "$";
      const width = isDouble ? 2 : 1;
      if (mathDelim === null) {
        mathDelim = token;
        mathStart = i;
      } else if (mathDelim === token) {
        mathRegions.push({ start: mathStart, end: i + width });
        mathDelim = null;
      }
      i += width;
      continue;
    }

    i++;
  }

  // An unterminated math region runs to end of document.
  if (mathDelim !== null) {
    mathRegions.push({ start: mathStart, end: n });
  }

  return { labels, mathRegions, commentRegions, environments, macros };
}

function offsetInRegions(regions: Region[], offset: number): boolean {
  // Regions are produced in source order and never overlap.
  for (const r of regions) {
    if (offset >= r.start && offset < r.end) return true;
    if (r.start > offset) break;
  }
  return false;
}

/** Reconstruct the open-environment stack and mode at a given offset. */
export function contextAt(scan: DocumentScan, offset: number): ScanContext {
  const stack: string[] = [];
  for (const occ of scan.environments) {
    // Only apply occurrences that fully precede the cursor.
    if (occ.end > offset) break;
    if (occ.type === "begin") {
      stack.push(occ.name);
    } else {
      const idx = stack.lastIndexOf(occ.name);
      if (idx !== -1) stack.length = idx;
    }
  }

  // A comment includes its trailing edge: the cursor sitting at end-of-line
  // (just before the newline / EOF) is still inside the comment.
  const inComment = scan.commentRegions.some(
    (r) => offset > r.start && offset <= r.end,
  );
  const inVerbatim = stack.some((name) => VERBATIM_ENVIRONMENTS.has(name));
  const inEnvMath = stack.some((name) => KATEX_ENVIRONMENTS.has(name));
  const inDelimMath = offsetInRegions(scan.mathRegions, offset);
  const mode: "text" | "math" =
    !inVerbatim && (inEnvMath || inDelimMath) ? "math" : "text";

  return {
    mode,
    inComment,
    inVerbatim,
    envStack: stack,
    currentEnvironment: stack[stack.length - 1],
  };
}
