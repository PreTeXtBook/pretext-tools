import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  isPublicationPtx,
  getCurrentTag,
  rangeInLine,
  lineToPosition,
} from './utils';

function doc(text: string) {
  return TextDocument.create('file:///test.ptx', 'pretext', 1, text);
}

describe('isPublicationPtx', () => {
  it('detects a publication file by its opening tag', () => {
    expect(
      isPublicationPtx(doc('<publication>\n  <common/>\n</publication>')),
    ).toBe(true);
  });

  it('returns false for ordinary source documents', () => {
    expect(isPublicationPtx(doc('<pretext>\n  <book/>\n</pretext>'))).toBe(
      false,
    );
  });
});

describe('getCurrentTag', () => {
  it('returns the innermost unclosed tag at the cursor', () => {
    const text = '<section>\n  <p>hello';
    // Cursor sits at the end of "hello" on line 1.
    const tag = getCurrentTag(doc(text), { line: 1, character: 8 });
    expect(tag).toBe('p');
  });

  it('pops closed tags off the stack', () => {
    const text = '<section>\n  <p>hi</p>\n  ';
    // After </p> closes, the enclosing tag is <section> again.
    const tag = getCurrentTag(doc(text), { line: 2, character: 2 });
    expect(tag).toBe('section');
  });

  it('returns undefined outside of any tag', () => {
    expect(
      getCurrentTag(doc('plain text'), { line: 0, character: 5 }),
    ).toBeUndefined();
  });
});

describe('rangeInLine', () => {
  it('shifts start and end relative to the given position, staying on the line', () => {
    const range = rangeInLine({ line: 4, character: 10 }, -1, 0);
    expect(range).toEqual({
      start: { line: 4, character: 9 },
      end: { line: 4, character: 10 },
    });
  });
});

describe('lineToPosition', () => {
  it('spans from the start of the line to the given position', () => {
    expect(lineToPosition({ line: 2, character: 7 })).toEqual({
      start: { line: 2, character: 0 },
      end: { line: 2, character: 7 },
    });
  });
});
