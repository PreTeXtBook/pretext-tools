/**
 * Custom remark plugin for parsing math delimiters.
 *
 * Supports:
 * - Display math: `$$...$$` (block or inline) and `\[...\]` (LaTeX)
 * - Inline math: `$...$` and `\(...\)` (LaTeX)
 *
 * Creates 'math' nodes with optional 'meta' field to distinguish display from inline.
 *
 * A single `$` is also how authors write dollar amounts, so `$...$` only counts
 * as math in the shape described on {@link closingDollar}; any other `$` is text.
 */

import type { Plugin } from "unified";
import type { Root, Text } from "mdast";
import { visit } from "unist-util-visit";

export interface Math {
  type: "math";
  value: string;
  meta?: string; // Can be 'display' or 'inline'
}

declare module "mdast" {
  interface PhrasingContentMap {
    math: Math;
  }
}

/**
 * Delimiter pattern with metadata.
 */
interface DelimiterPattern {
  open: string;
  close: string;
  isDisplay: boolean;
}

const DELIMITERS: DelimiterPattern[] = [
  // Display math (check these first, before single $)
  { open: "$$", close: "$$", isDisplay: true },
  { open: "\\[", close: "\\]", isDisplay: true },
  // Inline math
  { open: "$", close: "$", isDisplay: false },
  { open: "\\(", close: "\\)", isDisplay: false },
];

// A token is an id between two private-use characters, so Markdown treats it as
// a word and the text after it can't run into the id (`$$x$$2`).
const TOKEN_OPEN = "";
const TOKEN_CLOSE = "";
const TOKEN_RE = new RegExp(`${TOKEN_OPEN}\\d+${TOKEN_CLOSE}`, "g");

const WORD = /[\p{L}\p{N}]/u;

/** A math node standing in for a token, plus the source it replaced. */
export interface MathToken extends Math {
  source: string;
}

export interface MathTokenizationResult {
  markdown: string;
  tokens: Map<string, MathToken>;
}

/** Whether the character at `index` is backslash-escaped. */
function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

/**
 * The `$` closing an inline math span opened by the `$` at `index`, or -1 if
 * that `$` is just a dollar sign. Math hugs its delimiters and stands apart
 * from the words around it:
 *
 * - the opener doesn't follow a letter or digit, and the closer isn't followed
 *   by one (`a$b`, `$5-$10`);
 * - the content doesn't start or end with whitespace (`$2 to $5`);
 * - it closes on the same line, so an unclosed `$` stops at the line's end.
 *
 * Only the next unescaped `$` can close: when it can't, nothing further along
 * can either, so `$5 and $x$` leaves the first `$` as text and `$x$` as math.
 */
function closingDollar(text: string, index: number): number {
  const before = text[index - 1] ?? "";
  const after = text[index + 1] ?? "";
  if (isEscaped(text, index) || before === "$" || after === "$") return -1;
  if (WORD.test(before) || after === "" || /\s/.test(after)) return -1;

  let close = text.indexOf("$", index + 1);
  while (close !== -1 && isEscaped(text, close)) {
    close = text.indexOf("$", close + 1);
  }
  if (close === -1) return -1;

  const content = text.slice(index + 1, close);
  if (content.includes("\n") || content.includes("`")) return -1;
  if (/\s$/.test(content) || WORD.test(text[close + 1] ?? "")) return -1;
  return close;
}

function findNextDelimiter(
  text: string,
  pos: number,
): {
  index: number;
  pattern: DelimiterPattern;
  content: string;
} | null {
  let nextMatch: {
    index: number;
    pattern: DelimiterPattern;
    content: string;
  } | null = null;

  for (const pattern of DELIMITERS) {
    let index = text.indexOf(pattern.open, pos);
    let closeIndex = -1;
    while (index !== -1) {
      closeIndex =
        pattern.open === "$"
          ? closingDollar(text, index)
          : text.indexOf(pattern.close, index + pattern.open.length);
      // Only a `$` can be passed over: the next one may still open math.
      if (closeIndex !== -1 || pattern.open !== "$") break;
      index = text.indexOf(pattern.open, index + 1);
    }
    if (index === -1 || closeIndex === -1) continue;

    if (!nextMatch || index < nextMatch.index) {
      const content = text.substring(index + pattern.open.length, closeIndex);
      nextMatch = { index, pattern, content };
    }
  }

  return nextMatch;
}

/**
 * Find the extent of the next backtick code region (inline code span or fenced
 * code block) starting at or after `fromPos`. Returns `{start, end}` where
 * `end` is the index of the first character AFTER the region, or `null` if no
 * code region exists.
 */
function findNextCodeRegion(
  text: string,
  fromPos: number,
): { start: number; end: number } | null {
  let p = fromPos;

  while (p < text.length) {
    const backtickIndex = text.indexOf("`", p);
    if (backtickIndex === -1) return null;

    // Count consecutive backticks at this position
    let tickCount = 0;
    let q = backtickIndex;
    while (q < text.length && text[q] === "`") {
      tickCount++;
      q++;
    }

    const openTicks = "`".repeat(tickCount);
    // Search for a matching closing run of exactly the same length
    let searchFrom = q;
    while (searchFrom < text.length) {
      const closeIndex = text.indexOf(openTicks, searchFrom);
      if (closeIndex === -1) break;

      const afterClose = closeIndex + tickCount;
      // Exact match: the character after the closing run must not be another backtick
      if (afterClose >= text.length || text[afterClose] !== "`") {
        return { start: backtickIndex, end: afterClose };
      }
      // Closing run has extra backticks – keep searching
      searchFrom = closeIndex + 1;
    }

    // No valid close found for this opening run – skip past it and keep looking
    p = backtickIndex + tickCount;
  }

  return null;
}

export function tokenizeMathInMarkdown(
  markdown: string,
): MathTokenizationResult {
  const tokens = new Map<string, MathToken>();
  let out = "";
  let pos = 0;
  let id = 0;

  while (pos < markdown.length) {
    // Skip any backtick code region that precedes the next math delimiter,
    // so that $ signs inside code spans are never tokenized as math.
    const codeRegion = findNextCodeRegion(markdown, pos);
    const next = findNextDelimiter(markdown, pos);

    if (codeRegion && (!next || codeRegion.start < next.index)) {
      // Copy everything up to and including the code region verbatim
      out += markdown.substring(pos, codeRegion.end);
      pos = codeRegion.end;
      continue;
    }

    if (!next) {
      out += markdown.substring(pos);
      break;
    }

    out += markdown.substring(pos, next.index);
    const token = `${TOKEN_OPEN}${id}${TOKEN_CLOSE}`;
    out += token;
    const end =
      next.index +
      next.pattern.open.length +
      next.content.length +
      next.pattern.close.length;
    tokens.set(token, {
      type: "math",
      value: next.content,
      meta: next.pattern.isDisplay ? "display" : "inline",
      source: markdown.substring(next.index, end),
    });

    pos = end;
    id += 1;
  }

  return { markdown: out, tokens };
}

/**
 * Find math in a string and split into text and math nodes.
 * Returns array of alternating Text and Math nodes.
 *
 * Order matters: we check longer/more specific delimiters first.
 */
export function splitTextWithMath(text: string): (Text | Math)[] {
  const result: (Text | Math)[] = [];
  let pos = 0;

  while (pos < text.length) {
    const nextMatch = findNextDelimiter(text, pos);

    if (!nextMatch) {
      // No more math found
      if (pos < text.length) {
        result.push({ type: "text", value: text.substring(pos) });
      }
      break;
    }

    // Add text before math
    if (nextMatch.index > pos) {
      result.push({
        type: "text",
        value: text.substring(pos, nextMatch.index),
      });
    }

    // Add math node
    result.push({
      type: "math",
      value: nextMatch.content,
      meta: nextMatch.pattern.isDisplay ? "display" : "inline",
    });

    pos =
      nextMatch.index +
      nextMatch.pattern.open.length +
      nextMatch.content.length +
      nextMatch.pattern.close.length;
  }

  return result.length === 0 ? [{ type: "text", value: text }] : result;
}

function splitTextWithMathTokens(
  text: string,
  tokens: Map<string, MathToken>,
): (Text | Math)[] {
  const result: (Text | Math)[] = [];
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;

  let match = TOKEN_RE.exec(text);
  while (match) {
    const start = match.index;
    const token = match[0];

    if (start > lastIndex) {
      result.push({ type: "text", value: text.substring(lastIndex, start) });
    }

    const mathNode = tokens.get(token);
    if (mathNode) {
      result.push(mathNode);
    } else {
      result.push({ type: "text", value: token });
    }

    lastIndex = start + token.length;
    match = TOKEN_RE.exec(text);
  }

  if (lastIndex < text.length) {
    result.push({ type: "text", value: text.substring(lastIndex) });
  }

  return result.length === 0 ? [{ type: "text", value: text }] : result;
}

/**
 * Replace every text node with the nodes `split` makes of it. Display math is
 * only valid directly in a paragraph, so anywhere else (a title, emphasis, a
 * link) it comes out as inline math.
 */
function splitTextNodes(
  tree: Root,
  split: (text: string) => (Text | Math)[],
): void {
  visit(tree, "text", (node: Text, index, parent: any) => {
    if (!parent || index === undefined) return;
    const displayAllowed =
      parent.type === "paragraph" && !parent.data?.directiveLabel;
    const nodes = split(node.value).map((child) =>
      child.type === "math" && !displayAllowed
        ? { ...child, meta: "inline" }
        : child,
    );
    parent.children.splice(index, 1, ...nodes);
    return index + nodes.length;
  });
}

/**
 * Remark plugin that detects and parses math delimiters in text nodes.
 */
export function applyMathDelimiters(tree: Root): void {
  splitTextNodes(tree, splitTextWithMath);
}

/** The node fields besides text where a token can end up. */
const LITERAL_FIELDS = ["value", "url", "title", "alt"];

/** Put back the source of any tokens in `text`. */
export function restoreMathTokens(
  text: string,
  tokens: Map<string, MathToken>,
): string {
  return text.replace(TOKEN_RE, (token) => tokens.get(token)?.source ?? token);
}

export function applyMathTokens(
  tree: Root,
  tokens: Map<string, MathToken>,
): void {
  splitTextNodes(tree, (text) => splitTextWithMathTokens(text, tokens));

  // A token anywhere else was never math: it's a `$` in a URL, a raw tag, etc.
  visit(tree, (node: any) => {
    for (const field of LITERAL_FIELDS) {
      if (typeof node[field] === "string") {
        node[field] = restoreMathTokens(node[field], tokens);
      }
    }
    for (const [name, value] of Object.entries(node.attributes ?? {})) {
      if (typeof value === "string") {
        node.attributes[name] = restoreMathTokens(value, tokens);
      }
    }
  });
}

const remarkMath: Plugin<[], Root> = () => {
  return (tree: Root) => {
    applyMathDelimiters(tree);
  };
};

export default remarkMath;
