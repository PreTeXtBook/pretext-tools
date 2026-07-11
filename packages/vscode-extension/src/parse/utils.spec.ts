import { describe, it, expect } from 'vitest';
import { fromXml } from 'xast-util-from-xml';
import { Element } from 'xast';
import {
  isElement,
  unifiedPositionToLspPosition,
  positionOfSubstring,
  elementAtOffset,
} from './utils';

describe('isElement', () => {
  it('returns true for an element node', () => {
    expect(isElement({ type: 'element', name: 'p', children: [] })).toBe(true);
  });

  it('returns false for non-element nodes and non-objects', () => {
    expect(isElement({ type: 'text', value: 'hi' })).toBe(false);
    expect(isElement(null)).toBe(false);
    expect(isElement(undefined)).toBe(false);
    expect(isElement('element')).toBe(false);
  });
});

describe('unifiedPositionToLspPosition', () => {
  it('converts 1-based unified positions to 0-based LSP positions', () => {
    const lsp = unifiedPositionToLspPosition({
      start: { line: 3, column: 5, offset: 0 },
      end: { line: 3, column: 9, offset: 4 },
    });
    expect(lsp).toEqual({
      start: { line: 2, character: 4 },
      end: { line: 2, character: 8 },
    });
  });

  it('returns a zero range when position is undefined', () => {
    expect(unifiedPositionToLspPosition(undefined)).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });
  });
});

describe('positionOfSubstring', () => {
  const origin = {
    start: { line: 5, column: 3, offset: 0 },
    end: { line: 5, column: 14, offset: 11 },
  };

  it('locates a substring on a single line by offsetting the origin column', () => {
    // "hello" is the first 5 characters of "hello world".
    const pos = positionOfSubstring(0, 5, origin, 'hello world');
    expect(pos.start).toEqual({ line: 5, column: 3 });
    expect(pos.end).toEqual({ line: 5, column: 8 });
  });

  it('resets the column to be line-absolute once a newline is crossed', () => {
    // "cd" lives on the second line of "ab\ncd".
    const pos = positionOfSubstring(
      3,
      5,
      {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 2, column: 3, offset: 5 },
      },
      'ab\ncd',
    );
    expect(pos.start).toEqual({ line: 2, column: 1 });
    expect(pos.end).toEqual({ line: 2, column: 3 });
  });

  it('clamps to the source length when the requested range runs past the end', () => {
    const pos = positionOfSubstring(0, 999, origin, 'hello world');
    expect(pos.end).toEqual({ line: 5, column: 14 });
  });
});

describe('elementAtOffset', () => {
  const source = `<p><em>hi</em></p>`;
  const ast = fromXml(source);

  it('returns the innermost element containing the offset', () => {
    // The "h" of "hi" sits at offset 7 (inside <em>).
    const el = elementAtOffset(7, ast) as Element;
    expect(el).not.toBeNull();
    expect(el.name).toBe('em');
  });

  it('returns null when the offset is outside every element', () => {
    expect(elementAtOffset(999, ast)).toBeNull();
  });
});
