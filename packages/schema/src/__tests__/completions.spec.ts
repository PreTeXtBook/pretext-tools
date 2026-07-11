import { describe, it, expect } from 'vitest';
import { getCompletions, clearCompletionCache } from '../completions';
import { testGrammar } from './helpers';
import type { Position } from '../types';

function complete(text: string, position: Position) {
  return getCompletions({ text, position, grammar: testGrammar() }).map(
    (c) => c.label,
  );
}

describe('getCompletions', () => {
  it("offers child elements inside an element's content", () => {
    // Cursor after the <p> line, inside <article>.
    const text = `<pretext>
  <article xml:id="a">
    <title>Hi</title>
    <p>text</p>

  </article>
</pretext>`;
    const labels = complete(text, { line: 4, character: 4 });
    expect(labels).toContain('p');
  });

  it('filters element completions by the partially-typed name', () => {
    const text = `<pretext>
  <article xml:id="a">
    <title>Hi</title>
    <p>text</p>
    <p
  </article>
</pretext>`;
    const labels = complete(text, { line: 4, character: 6 });
    expect(labels).toContain('p');
    expect(labels.every((l) => l.startsWith('p'))).toBe(true);
  });

  it('de-duplicates repeated possibilities', () => {
    const text = `<pretext>
  <article xml:id="a">
    <`;
    const labels = complete(text, { line: 2, character: 5 });
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('offers attribute names inside a start tag', () => {
    const text = `<pretext>
  <article `;
    const labels = complete(text, { line: 1, character: 11 });
    expect(labels).toContain('xml:id');
  });

  it('excludes already-present attributes', () => {
    const text = `<pretext>
  <article xml:id="a" `;
    const labels = complete(text, { line: 1, character: 22 });
    expect(labels).not.toContain('xml:id');
  });

  it('returns nothing inside an attribute value', () => {
    const text = `<pretext>
  <article xml:id="`;
    const labels = complete(text, { line: 1, character: 19 });
    expect(labels).toEqual([]);
  });
});

describe('getCompletions with a uri (walker caching)', () => {
  function posAt(s: string): Position {
    const nl = s.lastIndexOf('\n');
    return {
      line: (s.match(/\n/g) ?? []).length,
      character: nl === -1 ? s.length : s.length - nl - 1,
    };
  }

  it('produces the same result via incremental (cached) and one-shot calls', () => {
    const text = `<pretext>
  <article xml:id="a">
    <title>Hi</title>
    <p>text</p>
    `;
    const grammar = testGrammar();
    const expected = getCompletions({
      text,
      position: posAt(text),
      grammar,
    }).map((c) => c.label);
    expect(expected).toContain('p');

    const uri = 'file:///cache-test.ptx';
    clearCompletionCache(uri);
    let labels: string[] = [];
    // Simulate typing the document one character at a time, as an LSP client
    // would request completions on every keystroke.
    for (let i = 1; i <= text.length; i++) {
      const partial = text.slice(0, i);
      labels = getCompletions({
        text: partial,
        position: posAt(partial),
        grammar,
        uri,
      }).map((c) => c.label);
    }
    expect(labels).toEqual(expected);
    clearCompletionCache(uri);
  });

  it('does not let a speculative attribute lookup corrupt later cached completions', () => {
    const grammar = testGrammar();
    const uri = 'file:///cache-purity-test.ptx';
    clearCompletionCache(uri);

    const midTag = `<pretext>
  <article `;
    const attrLabels = getCompletions({
      text: midTag,
      position: posAt(midTag),
      grammar,
      uri,
    }).map((c) => c.label);
    expect(attrLabels).toContain('xml:id');

    // Extend the same cached session with the real document text (closing the
    // tag for real). If the attribute lookup above had mutated the cached
    // walker instead of a clone, the walker would think it already re-entered
    // <article> once, and would no longer expect <title> here.
    const grown = midTag + `xml:id="a">\n    `;
    const labels = getCompletions({
      text: grown,
      position: posAt(grown),
      grammar,
      uri,
    }).map((c) => c.label);
    expect(labels).toContain('title');
    clearCompletionCache(uri);
  });
});
