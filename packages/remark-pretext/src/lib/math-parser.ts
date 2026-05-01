/**
 * Custom remark plugin for parsing math delimiters.
 * 
 * Supports:
 * - Display math: `$$...$$` (block or inline) and `\[...\]` (LaTeX)
 * - Inline math: `$...$` and `\(...\)` (LaTeX)
 * 
 * Creates 'math' nodes with optional 'meta' field to distinguish display from inline.
 */

import type { Plugin } from 'unified';
import type { Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

export interface Math {
  type: 'math';
  value: string;
  meta?: string; // Can be 'display' or 'inline'
}

declare module 'mdast' {
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
  { open: '$$', close: '$$', isDisplay: true },
  { open: '\\[', close: '\\]', isDisplay: true },
  // Inline math
  { open: '$', close: '$', isDisplay: false },
  { open: '\\(', close: '\\)', isDisplay: false },
];

const TOKEN_PREFIX = 'PTX_MATH_TOKEN_';
const TOKEN_RE = new RegExp(`${TOKEN_PREFIX}(\\d+)`, 'g');

export interface MathTokenizationResult {
  markdown: string;
  tokens: Map<string, Math>;
}

function findNextDelimiter(text: string, pos: number): {
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
    const index = text.indexOf(pattern.open, pos);
    if (index === -1) continue;

    const closeIndex = text.indexOf(pattern.close, index + pattern.open.length);
    if (closeIndex === -1) continue;

    if (pattern.open === '$') {
      if (
        (index > 0 && text[index - 1] === '$')
        || (index + 1 < text.length && text[index + 1] === '$')
      ) {
        continue;
      }
    }

    if (!nextMatch || index < nextMatch.index) {
      const content = text.substring(index + pattern.open.length, closeIndex);
      nextMatch = { index, pattern, content };
    }
  }

  return nextMatch;
}

export function tokenizeMathInMarkdown(markdown: string): MathTokenizationResult {
  const tokens = new Map<string, Math>();
  let out = '';
  let pos = 0;
  let id = 0;

  while (pos < markdown.length) {
    const next = findNextDelimiter(markdown, pos);
    if (!next) {
      out += markdown.substring(pos);
      break;
    }

    out += markdown.substring(pos, next.index);
    const token = `${TOKEN_PREFIX}${id}`;
    out += token;
    tokens.set(token, {
      type: 'math',
      value: next.content,
      meta: next.pattern.isDisplay ? 'display' : 'inline',
    });

    pos = next.index + next.pattern.open.length + next.content.length + next.pattern.close.length;
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
        result.push({ type: 'text', value: text.substring(pos) });
      }
      break;
    }

    // Add text before math
    if (nextMatch.index > pos) {
      result.push({
        type: 'text',
        value: text.substring(pos, nextMatch.index),
      });
    }

    // Add math node
    result.push({
      type: 'math',
      value: nextMatch.content,
      meta: nextMatch.pattern.isDisplay ? 'display' : 'inline',
    });

    pos = nextMatch.index + nextMatch.pattern.open.length + nextMatch.content.length + nextMatch.pattern.close.length;
  }

  return result.length === 0 ? [{ type: 'text', value: text }] : result;
}

function splitTextWithMathTokens(text: string, tokens: Map<string, Math>): (Text | Math)[] {
  const result: (Text | Math)[] = [];
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;

  let match = TOKEN_RE.exec(text);
  while (match) {
    const start = match.index;
    const token = match[0];

    if (start > lastIndex) {
      result.push({ type: 'text', value: text.substring(lastIndex, start) });
    }

    const mathNode = tokens.get(token);
    if (mathNode) {
      result.push(mathNode);
    } else {
      result.push({ type: 'text', value: token });
    }

    lastIndex = start + token.length;
    match = TOKEN_RE.exec(text);
  }

  if (lastIndex < text.length) {
    result.push({ type: 'text', value: text.substring(lastIndex) });
  }

  return result.length === 0 ? [{ type: 'text', value: text }] : result;
}

/**
 * Remark plugin that detects and parses math delimiters in text nodes.
 */
export function applyMathDelimiters(tree: Root): void {
  visit(tree, 'paragraph', (node: any) => {
    const children = (node.children || []) as (Text | Math)[];
    const newChildren: (Text | Math)[] = [];

    for (const child of children) {
      if (child.type === 'text') {
        const nodes = splitTextWithMath(child.value);
        newChildren.push(...nodes);
      } else {
        newChildren.push(child);
      }
    }

    node.children = newChildren;
  });
}

export function applyMathTokens(tree: Root, tokens: Map<string, Math>): void {
  visit(tree, 'paragraph', (node: any) => {
    const children = (node.children || []) as (Text | Math)[];
    const newChildren: (Text | Math)[] = [];

    for (const child of children) {
      if (child.type === 'text') {
        const nodes = splitTextWithMathTokens(child.value, tokens);
        newChildren.push(...nodes);
      } else {
        newChildren.push(child);
      }
    }

    node.children = newChildren;
  });
}

const remarkMath: Plugin<[], Root> = () => {
  return (tree: Root) => {
    applyMathDelimiters(tree);
  };
};

export default remarkMath;

