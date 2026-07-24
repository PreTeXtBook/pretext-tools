// A lightweight, single-pass scanner over Markdown-style PreTeXt source.
//
// Like the LaTeX flavor's scanner, it answers local questions the completion
// engine and linter need cheaply and without a full remark parse: at a given
// offset, am I in math / a fenced code block / an HTML comment / frontmatter,
// and which directives are open? It also harvests every id (`{#id}`, `id=`,
// `label=`) for cross-reference completion.
//
// It recognizes both directive syntaxes the converter accepts, mirroring the
// pipeline `indentation → colons → directive-normalize` in
//   packages/remark-pretext/src/lib/remark-pretext.ts:
//   - COLON FENCES (`:::name` … `:::`) whose open/close colon counts must match
//     to pair (directive-normalizer.ts:122); a non-matching close is an orphan.
//   - PYTHON-STYLE markers (`Name:` with an indented body), which open a
//     directive whose body is the deeper-indented block and which close
//     implicitly when a later line outdents (indentation-normalizer.ts). We
//     synthesize `close` occurrences at those dedent points.
//
// This dialect disables indented code blocks (remark-pretext.ts:108), so
// indentation is only ever python-directive structure, never code.
//
// The scanner is line-oriented for block constructs but scans characters within
// a line for math delimiters and HTML comments, carrying math/comment state
// across line boundaries. It never throws.

import { isKnownContainerDirective } from "../data/directives";

export interface Region {
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

export interface LabelInfo {
  name: string;
  /** Offset of the first character of the id. */
  offset: number;
}

export interface DirectiveOccurrence {
  /** Directive name; empty string for a bare closing fence (`:::`). */
  name: string;
  type: "open" | "close" | "leaf";
  /** How the directive was written. */
  style: "fence" | "python";
  /**
   * Number of leading colons on the marker: 3+ for container fences, exactly 2
   * for leaf directives. Synthesized python markers carry 0 (they pair by the
   * indentation stack, not by colon count).
   */
  colons: number;
  /** Offset of the marker start (first colon, or the name for python markers). */
  start: number;
  /** Offset just past the marker (or the dedent line start, for python closes). */
  end: number;
}

export interface DocumentScan {
  labels: LabelInfo[];
  /** Math regions delimited by `$`, `$$`, `\(…\)`, `\[…\]`. */
  mathRegions: Region[];
  /** `<!-- … -->` comment regions. */
  commentRegions: Region[];
  /** Fenced code blocks (` ``` ` / `~~~`), including the fence lines. */
  codeRegions: Region[];
  /** Leading `---` … `---` YAML frontmatter, if present. */
  frontmatterRegion: Region | null;
  /** Directive markers in source order (synthesized python closes included). */
  directives: DirectiveOccurrence[];
}

export interface ScanContext {
  mode: "text" | "math";
  inComment: boolean;
  inCode: boolean;
  inFrontmatter: boolean;
  /** Open container directives, innermost last. */
  directiveStack: string[];
  /** Innermost open container directive, if any. */
  currentDirective?: string;
}

const CONTAINER_FENCE_RE = /^(:{3,})\s*([A-Za-z][\w-]*)?/;
const LEAF_RE = /^::([A-Za-z][\w-]*)/;
const CODE_FENCE_RE = /^(`{3,}|~{3,})/;
// A python-style marker body (the line without its trailing colon): a directive
// name followed only by `[title]` / `{attrs}` groups (indentation-normalizer.ts).
const PYTHON_MARKER_RE =
  /^([A-Za-z][A-Za-z0-9_-]*)((?:\[[^\]]*\]|\{[^}]*\})*)$/;
const ID_SHORTHAND_RE = /\{#([\w:.-]+)\}/g;
const ID_ATTR_RE = /(?:xml:id|id|label)\s*=\s*["']?([\w:.-]+)/g;
const FRONTMATTER_ID_RE = /^(?:xmlid|xml:id|id|label)\s*:\s*["']?([\w:.-]+)/;

interface LineInfo {
  text: string;
  start: number;
}

/** Indentation width in columns, counting a tab as 4 (indentation-normalizer.ts). */
function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

/** Number of leading-whitespace *characters* (for offset math). */
function indentChars(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * If `trimmed` is a python-style directive marker (`Name[...]{...}:` with a
 * name the converter supports), return the canonical lowercase name; else null.
 * Mirrors `parseIndentationDirective` in indentation-normalizer.ts.
 */
function pythonDirectiveName(trimmed: string): string | null {
  if (!trimmed.endsWith(":")) return null;
  const body = trimmed.slice(0, -1);
  const m = PYTHON_MARKER_RE.exec(body);
  if (!m) return null;
  const name = m[1].toLowerCase();
  return isKnownContainerDirective(name) ? name : null;
}

/** True if the next non-blank line after `i` is indented deeper than `lines[i]`. */
function hasIndentedBody(lines: LineInfo[], i: number): boolean {
  const current = indentWidth(lines[i].text);
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].text.trim() === "") continue;
    return indentWidth(lines[j].text) > current;
  }
  return false;
}

export function scanDocument(text: string): DocumentScan {
  const labels: LabelInfo[] = [];
  const mathRegions: Region[] = [];
  const commentRegions: Region[] = [];
  const codeRegions: Region[] = [];
  const directives: DirectiveOccurrence[] = [];

  const n = text.length;

  // Cross-line inline state.
  let mathDelim: string | null = null;
  let mathStart = 0;
  let inComment = false;
  let commentStart = 0;

  // Fenced-code state.
  let fenceMarker: string | null = null; // e.g. "```" or "~~~~"
  let fenceStart = 0;

  // Open python-style directives, innermost last (they close by dedent).
  const pyStack: { name: string; indent: number }[] = [];

  // --- frontmatter (leading `---` … `---`) --------------------------------
  let frontmatterRegion: Region | null = null;
  let bodyStart = 0;
  if (text.startsWith("---\n") || text === "---") {
    const closeIdx = findFrontmatterClose(text);
    if (closeIdx !== -1) {
      frontmatterRegion = { start: 0, end: closeIdx };
      bodyStart = closeIdx;
      harvestFrontmatterIds(text.slice(0, closeIdx), labels);
    }
  }

  const lines = splitLines(text, bodyStart);

  /** Emit python closes for every open marker at indent >= `indent`. */
  const closePythonTo = (indent: number, at: number) => {
    while (pyStack.length > 0 && pyStack[pyStack.length - 1].indent >= indent) {
      pyStack.pop();
      directives.push({
        name: "",
        type: "close",
        style: "python",
        colons: 0,
        start: at,
        end: at,
      });
    }
  };

  /** Scan the characters of one line for math delimiters and HTML comments. */
  const scanInline = (line: string, lineStart: number, from: number) => {
    let i = from;
    while (i < line.length) {
      const c = line[i];

      if (c === "\\") {
        const next = line[i + 1];
        if (next === "(" || next === "[") {
          if (mathDelim === null) {
            mathDelim = next === "(" ? "\\)" : "\\]";
            mathStart = lineStart + i;
          }
          i += 2;
          continue;
        }
        if (next === ")" || next === "]") {
          const token = "\\" + next;
          if (mathDelim === token) {
            mathRegions.push({ start: mathStart, end: lineStart + i + 2 });
            mathDelim = null;
          }
          i += 2;
          continue;
        }
        // Any other escape (`\$`, `\_`, `\*`, `\\`): consume both chars.
        i += 2;
        continue;
      }

      if (c === "$") {
        const isDouble = line[i + 1] === "$";
        const token = isDouble ? "$$" : "$";
        const width = isDouble ? 2 : 1;
        if (mathDelim === null) {
          mathDelim = token;
          mathStart = lineStart + i;
        } else if (mathDelim === token) {
          mathRegions.push({ start: mathStart, end: lineStart + i + width });
          mathDelim = null;
        }
        i += width;
        continue;
      }

      // HTML comment start (only meaningful outside math).
      if (mathDelim === null && line.startsWith("<!--", i)) {
        const close = line.indexOf("-->", i + 4);
        if (close !== -1) {
          commentRegions.push({
            start: lineStart + i,
            end: lineStart + close + 3,
          });
          i = close + 3;
          continue;
        }
        // Unterminated on this line: comment runs into following lines.
        inComment = true;
        commentStart = lineStart + i;
        return;
      }

      i++;
    }
  };

  // --- main line loop ------------------------------------------------------
  for (let li = 0; li < lines.length; li++) {
    const { text: line, start: lineStart } = lines[li];
    const lineEnd = lineStart + line.length;

    // 1. Inside a fenced code block: everything is literal until the close.
    if (fenceMarker !== null) {
      if (isClosingCodeFence(line, fenceMarker)) {
        codeRegions.push({ start: fenceStart, end: lineEnd });
        fenceMarker = null;
      }
      continue;
    }

    // 2. Inside a multi-line HTML comment: look for its close.
    if (inComment) {
      const close = line.indexOf("-->");
      if (close !== -1) {
        commentRegions.push({
          start: commentStart,
          end: lineStart + close + 3,
        });
        inComment = false;
        scanInline(line, lineStart, close + 3);
      }
      continue;
    }

    // 3. Block-level constructs are only recognized at "text" line starts:
    //    a `:::` inside an open `$$…$$` block must not read as a directive.
    if (mathDelim === null) {
      const wsChars = indentChars(line);
      const trimmed = line.slice(wsChars);

      // Code fences toggle without running python dedent (indentation-
      // normalizer.ts short-circuits on fence lines).
      const codeFence = CODE_FENCE_RE.exec(trimmed);
      if (codeFence) {
        fenceMarker = codeFence[1];
        fenceStart = lineStart;
        continue;
      }

      // Blank lines never dedent a python directive.
      if (trimmed === "") continue;

      // Any non-blank content at this indent closes deeper python directives
      // before it is interpreted (indentation-normalizer.ts:256).
      const indent = indentWidth(line);
      closePythonTo(indent, lineStart);

      const markerStart = lineStart + wsChars;

      const container = CONTAINER_FENCE_RE.exec(trimmed);
      if (container) {
        const colons = container[1].length;
        const name = container[2];
        if (name) {
          directives.push({
            name,
            type: "open",
            style: "fence",
            colons,
            start: markerStart,
            // container[0] spans the colons, any spacing, and the name.
            end: markerStart + container[0].length,
          });
        } else {
          directives.push({
            name: "",
            type: "close",
            style: "fence",
            colons,
            start: markerStart,
            end: markerStart + colons,
          });
        }
        harvestLineIds(line, lineStart, labels);
        continue;
      }

      const leaf = LEAF_RE.exec(trimmed);
      if (leaf && trimmed[2] !== ":") {
        directives.push({
          name: leaf[1],
          type: "leaf",
          style: "fence",
          colons: 2,
          start: markerStart,
          end: markerStart + 2 + leaf[1].length,
        });
        harvestLineIds(line, lineStart, labels);
        continue;
      }

      // Python-style marker (`Name:` with an indented body).
      const pyName = pythonDirectiveName(trimmed);
      if (pyName && hasIndentedBody(lines, li)) {
        directives.push({
          name: pyName,
          type: "open",
          style: "python",
          colons: 0,
          start: markerStart,
          end: markerStart + trimmed.length,
        });
        pyStack.push({ name: pyName, indent });
        harvestLineIds(line, lineStart, labels);
        continue;
      }

      harvestLineIds(line, lineStart, labels);
    }

    // 4. Inline scan for math and comments (also continues open math).
    scanInline(line, lineStart, 0);
  }

  // Unterminated regions run to end of document; open python directives close.
  closePythonTo(0, n);
  if (mathDelim !== null) mathRegions.push({ start: mathStart, end: n });
  if (inComment) commentRegions.push({ start: commentStart, end: n });
  if (fenceMarker !== null) codeRegions.push({ start: fenceStart, end: n });

  return {
    labels,
    mathRegions,
    commentRegions,
    codeRegions,
    frontmatterRegion,
    directives,
  };
}

/** Split `text` from `from` into lines with their start offsets. */
function splitLines(text: string, from: number): LineInfo[] {
  const lines: LineInfo[] = [];
  let idx = from;
  const n = text.length;
  while (idx <= n) {
    const nl = text.indexOf("\n", idx);
    const end = nl === -1 ? n : nl;
    lines.push({ text: text.slice(idx, end), start: idx });
    if (nl === -1) break;
    idx = nl + 1;
  }
  return lines;
}

function findFrontmatterClose(text: string): number {
  // Find the next line that is exactly `---` after the opening line.
  let idx = text.indexOf("\n") + 1;
  if (idx === 0) return -1;
  while (idx <= text.length) {
    const nl = text.indexOf("\n", idx);
    const end = nl === -1 ? text.length : nl;
    if (text.slice(idx, end).trim() === "---") return end;
    if (nl === -1) break;
    idx = nl + 1;
  }
  return -1;
}

function harvestFrontmatterIds(block: string, labels: LabelInfo[]): void {
  let idx = 0;
  while (idx <= block.length) {
    const nl = block.indexOf("\n", idx);
    const end = nl === -1 ? block.length : nl;
    const line = block.slice(idx, end);
    const m = FRONTMATTER_ID_RE.exec(line.trim());
    if (m) {
      const at = line.indexOf(m[1], line.indexOf(":"));
      labels.push({ name: m[1], offset: idx + Math.max(at, 0) });
    }
    if (nl === -1) break;
    idx = nl + 1;
  }
}

function harvestLineIds(
  line: string,
  lineStart: number,
  labels: LabelInfo[],
): void {
  for (const re of [ID_SHORTHAND_RE, ID_ATTR_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const at = line.indexOf(m[1], m.index);
      labels.push({ name: m[1], offset: lineStart + at });
    }
  }
}

/** True if `line` is a closing fence for an open ` ``` `/`~~~` block. */
function isClosingCodeFence(line: string, marker: string): boolean {
  const trimmed = line.trim();
  const ch = marker[0];
  if (trimmed.length < marker.length) return false;
  for (const c of trimmed) if (c !== ch) return false;
  return true;
}

function offsetInRegions(regions: Region[], offset: number): boolean {
  for (const r of regions) {
    if (offset >= r.start && offset < r.end) return true;
    if (r.start > offset) break;
  }
  return false;
}

/** Reconstruct the open-directive stack and mode at a given offset. */
export function contextAt(scan: DocumentScan, offset: number): ScanContext {
  const stack: { name: string; colons: number }[] = [];
  for (const occ of scan.directives) {
    // Only apply markers that fully precede the cursor. A marker whose span
    // reaches the cursor is the line currently being typed (e.g. `:::pro|`) and
    // is not yet "open" — excluding it keeps child-directive boosting anchored
    // to the *enclosing* directive.
    if (occ.end >= offset) break;
    if (occ.type === "open") {
      stack.push({ name: occ.name, colons: occ.colons });
    } else if (occ.type === "close") {
      const top = stack[stack.length - 1];
      // Python closes are implicit and always pop; a colon fence only pairs
      // when its colon count matches the innermost open (directive-normalizer).
      if (occ.style === "python") {
        stack.pop();
      } else if (top && top.colons === occ.colons) {
        stack.pop();
      }
      // A non-matching colon fence is an orphan: leave the stack unchanged.
    }
    // Leaf directives are self-closing: no stack effect.
  }

  const inCode = offsetInRegions(scan.codeRegions, offset);
  // A comment includes its trailing edge (cursor at end-of-comment counts).
  const inComment = scan.commentRegions.some(
    (r) => offset > r.start && offset <= r.end,
  );
  const inFrontmatter = scan.frontmatterRegion
    ? offset >= scan.frontmatterRegion.start &&
      offset < scan.frontmatterRegion.end
    : false;
  const inMath = offsetInRegions(scan.mathRegions, offset);
  const mode: "text" | "math" =
    inMath && !inCode && !inComment && !inFrontmatter ? "math" : "text";

  return {
    mode,
    inComment,
    inCode,
    inFrontmatter,
    directiveStack: stack.map((s) => s.name),
    currentDirective: stack[stack.length - 1]?.name,
  };
}
