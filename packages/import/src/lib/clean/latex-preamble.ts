import { firstBracketedString } from "./latex-utils";

export interface PreambleInfo {
  /** Argument of \documentclass{...}, e.g. "book" or "article". Defaults to "article". */
  documentClass: string;
  /** Inner content of \title{...}, or empty string. */
  title: string;
  /** Inner content of \author{...}, or empty string. */
  author: string;
  /** Collected \newcommand / \renewcommand / \DeclareMathOperator definitions. */
  macros: string;
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

export function splitLatexAtDocument(source: string): {
  preamble: string;
  body: string;
} {
  const BEGIN = "\\begin{document}";
  const END = "\\end{document}";
  const beginIdx = source.indexOf(BEGIN);
  if (beginIdx === -1) {
    return { preamble: "", body: source };
  }
  const preamble = source.slice(0, beginIdx).trim();
  const afterBegin = source.slice(beginIdx + BEGIN.length);
  const endIdx = afterBegin.indexOf(END);
  const body = (
    endIdx === -1 ? afterBegin : afterBegin.slice(0, endIdx)
  ).trim();
  return { preamble, body };
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the mandatory argument of a LaTeX command, e.g. `\title{...}`.
 * Skips an optional `[...]` argument if present.
 * Returns the inner content (without surrounding braces), or "".
 */
export function extractLatexField(source: string, cmdName: string): string {
  const re = new RegExp(`\\\\${cmdName}(?![a-zA-Z])`);
  const match = re.exec(source);
  if (!match) return "";

  let rest = source.slice(match.index + match[0].length).trimStart();

  // Skip optional [...]
  if (rest.startsWith("[")) {
    const [opt, after] = firstBracketedString(rest, 0, "[", "]");
    if (opt) rest = after.trimStart();
  }

  const [arg] = firstBracketedString(rest);
  return arg ? arg.slice(1, -1).trim() : "";
}

// ---------------------------------------------------------------------------
// Macro collection
// ---------------------------------------------------------------------------

const MACRO_START_RE =
  /^[ \t]*(\\(?:new|renew|provide)command\*?|\\DeclareMathOperator\*?|\\newenvironment\*?)\b/;

/**
 * Counts net unescaped brace depth change in a single line.
 * `\\{` and `\\}` are treated as escaped (depth-neutral).
 */
function lineBraceDepth(line: string): number {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++; // skip next char (escaped)
      continue;
    }
    if (line[i] === "{") depth++;
    else if (line[i] === "}") depth--;
  }
  return depth;
}

/**
 * Collects LaTeX macro definition lines from `preamble`, including multi-line
 * definitions (tracks brace depth to know when a definition is complete).
 * Returns the collected definitions joined with newlines.
 */
export function extractMacros(preamble: string): string {
  const lines = preamble.split("\n");
  const collected: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!MACRO_START_RE.test(lines[i])) {
      i++;
      continue;
    }

    let block = lines[i];
    let depth = lineBraceDepth(lines[i]);
    i++;

    // Accumulate continuation lines until braces are balanced
    while (depth > 0 && i < lines.length) {
      block += "\n" + lines[i];
      depth += lineBraceDepth(lines[i]);
      i++;
    }

    collected.push(block.trim());
  }

  return collected.join("\n");
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

function extractDocumentClassArg(preamble: string): string {
  const m = /\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/.exec(preamble);
  return m ? m[1].trim() : "article";
}

export function extractPreambleInfo(preamble: string): PreambleInfo {
  // Strip LaTeX comments before field extraction so `% \title{fake}` isn't found
  const noComments = preamble.replace(/(^|[^\\])%[^\n]*/gm, "$1");
  return {
    documentClass: extractDocumentClassArg(noComments),
    title: extractLatexField(noComments, "title"),
    author: extractLatexField(noComments, "author"),
    macros: extractMacros(noComments),
  };
}
