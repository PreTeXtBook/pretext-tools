import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { resolveXIncludes } from '../xinclude';
import { validateDocument } from '../validate';
import { testGrammar, fixturesDir } from './helpers';

const bookDir = path.join(fixturesDir, 'book');
const mainPath = path.join(bookDir, 'main.ptx');
const mainUri = pathToFileURL(mainPath).toString();
const ch1Uri = pathToFileURL(path.join(bookDir, 'ch1.ptx')).toString();

describe('resolveXIncludes', () => {
  it('inlines included files and tracks their origin', () => {
    const source = fs.readFileSync(mainPath, 'utf8');
    const resolved = resolveXIncludes(source, mainUri);
    expect(resolved.text).toContain('<chapter');
    expect(resolved.text).not.toContain('xi:include');
    // At least one merged line must originate from ch1.ptx.
    const fromCh1 = resolved.origin.filter((o) => o.uri === ch1Uri);
    expect(fromCh1.length).toBeGreaterThan(0);
    expect(resolved.problems).toEqual([]);
  });

  it('reports a missing include target', () => {
    const source = `<pretext>
  <xi:include href="does-not-exist.ptx" xmlns:xi="http://www.w3.org/2001/XInclude" />
</pretext>`;
    const resolved = resolveXIncludes(source, mainUri);
    expect(resolved.problems).toHaveLength(1);
    expect(resolved.problems[0].kind).toBe('xinclude-missing');
    expect(resolved.problems[0].line).toBe(1);
  });

  it('detects circular includes', () => {
    const reader = (p: string) => {
      // a.ptx includes b.ptx which includes a.ptx
      if (p.endsWith('a.ptx')) {
        return `<chapter><xi:include href="b.ptx" xmlns:xi="http://www.w3.org/2001/XInclude"/></chapter>`;
      }
      if (p.endsWith('b.ptx')) {
        return `<section><xi:include href="a.ptx" xmlns:xi="http://www.w3.org/2001/XInclude"/></section>`;
      }
      return undefined;
    };
    const source = `<pretext><xi:include href="a.ptx" xmlns:xi="http://www.w3.org/2001/XInclude"/></pretext>`;
    const resolved = resolveXIncludes(source, mainUri, reader);
    expect(resolved.problems.some((p) => p.kind === 'xinclude-circular')).toBe(
      true,
    );
  });
});

describe('validateDocument with xi:include', () => {
  it('maps an error in an included file back to that file', () => {
    const source = fs.readFileSync(mainPath, 'utf8');
    const result = validateDocument(source, testGrammar(), { uri: mainUri });

    // The <notallowed> error must be attributed to ch1.ptx, not main.ptx.
    const ch1Diags = result.diagnosticsByUri[ch1Uri] ?? [];
    expect(ch1Diags.length).toBeGreaterThan(0);
    const notAllowed = ch1Diags.find((d) => /notallowed/.test(d.message));
    expect(notAllowed).toBeDefined();
    // <notallowed> is on line 5 of ch1.ptx (0-based line 4).
    expect(notAllowed!.range.start.line).toBe(4);
  });

  it('resolves an xref target declared in an included file', () => {
    const reader = (p: string) => {
      if (p.endsWith('ch1.ptx')) {
        return `<chapter xml:id="ch1"><title>Chapter One</title><p xml:id="target">Body.</p></chapter>`;
      }
      return undefined;
    };
    const source = `<pretext>
  <book xml:id="bk">
    <title>Book</title>
    <chapter xml:id="c0">
      <title>Intro</title>
      <p>See <xref ref="target"/>.</p>
    </chapter>
    <xi:include href="ch1.ptx" xmlns:xi="http://www.w3.org/2001/XInclude"/>
  </book>
</pretext>`;
    const result = validateDocument(source, testGrammar(), {
      uri: mainUri,
      readFile: reader,
    });
    expect(
      result.diagnostics.filter((d) => d.code === 'dangling-reference'),
    ).toEqual([]);
  });

  it('reports a dangling xref target across included files', () => {
    const reader = (p: string) => {
      if (p.endsWith('ch1.ptx')) {
        return `<chapter xml:id="ch1"><title>Chapter One</title><p>Body.</p></chapter>`;
      }
      return undefined;
    };
    const source = `<pretext>
  <book xml:id="bk">
    <title>Book</title>
    <chapter xml:id="c0">
      <title>Intro</title>
      <p>See <xref ref="nope"/>.</p>
    </chapter>
    <xi:include href="ch1.ptx" xmlns:xi="http://www.w3.org/2001/XInclude"/>
  </book>
</pretext>`;
    const result = validateDocument(source, testGrammar(), {
      uri: mainUri,
      readFile: reader,
    });
    const diag = result.diagnostics.find(
      (d) => d.code === 'dangling-reference',
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toMatch(/nope/);
  });
});
