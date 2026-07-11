import { describe, expect, it } from 'vitest';
import { detectDocumentKind } from './document-kind';

describe('detectDocumentKind', () => {
  it('identifies a book by <book> root', () => {
    expect(detectDocumentKind('<pretext><book/></pretext>')).toBe('book');
  });

  it('identifies an article by <article>', () => {
    expect(detectDocumentKind('<pretext><article/></pretext>')).toBe('article');
  });

  it('falls back to book if <chapter> is present', () => {
    expect(detectDocumentKind('<chapter>x</chapter>')).toBe('book');
  });

  it('defaults to article for unknown structure', () => {
    expect(detectDocumentKind('<p>hello</p>')).toBe('article');
  });
});
