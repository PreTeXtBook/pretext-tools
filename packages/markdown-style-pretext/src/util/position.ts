import type { Position, Range } from "vscode-languageserver-types";

/**
 * Convert a zero-based character offset into an LSP `Position` (line/character).
 * Both hosts (the LSP server and Monaco) speak line/character, not offsets, so
 * completion `textEdit`s and diagnostics ranges are built from these.
 */
export function offsetToPosition(text: string, offset: number): Position {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: clamped - lineStart };
}

export function rangeFromOffsets(
  text: string,
  start: number,
  end: number,
): Range {
  return {
    start: offsetToPosition(text, start),
    end: offsetToPosition(text, end),
  };
}
