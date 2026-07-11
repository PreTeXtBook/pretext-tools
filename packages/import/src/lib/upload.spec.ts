import { describe, expect, it } from 'vitest';
import { importProjectFromFiles } from './upload';

function bytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) arr[i] = i % 256;
  return arr;
}

describe('importProjectFromFiles', () => {
  it('imports a single LaTeX file and produces a PreTeXt project layout', () => {
    const files = {
      'main.tex':
        '\\documentclass{article}\n\\begin{document}\nHello world.\n\\end{document}',
    };
    const result = importProjectFromFiles(files);
    expect('pretextError' in result).toBe(false);
    if ('pretextError' in result) return;

    expect(result.sourceType).toBe('tex');
    expect(result.documentKind).toBe('article');
    expect(result.outputFiles['source/main.ptx']).toContain('Hello world');
    expect(result.outputFiles['source/main.ptx']).toContain('<pretext>');
    expect(result.outputFiles['project.ptx']).toContain('<project');
    expect(result.outputFiles['publication/publication.ptx']).toContain(
      '<publication',
    );
    expect(result.nativeOutputFiles?.['source/main.tex']).toContain('Hello');
  });

  it('expands modular LaTeX before conversion', () => {
    const files = {
      'main.tex':
        '\\documentclass{article}\n\\begin{document}\n\\input{intro}\n\\end{document}',
      'intro.tex': 'Hello from the included file.',
    };
    const result = importProjectFromFiles(files);
    if ('pretextError' in result) {
      throw new Error(`unexpected error: ${result.pretextError}`);
    }
    const statuses = result.statusMessages.map((m) => m.message).join('\n');
    expect(statuses).toMatch(/Expanded 1 input/);
    expect(result.nativeOutputFiles?.['source/main.tex']).toContain(
      'Hello from the included file.',
    );
  });

  it('expands modular PreTeXt and splits a book by chapter', () => {
    const files = {
      'main.ptx':
        '<?xml version="1.0"?>\n<pretext><book xml:id="b">' +
        '<xi:include href="ch-intro.ptx"/>' +
        '<xi:include href="ch-methods.ptx"/>' +
        '</book></pretext>',
      'ch-intro.ptx':
        '<chapter xml:id="intro"><title>Intro</title><p>One.</p></chapter>',
      'ch-methods.ptx':
        '<chapter xml:id="methods"><title>Methods</title><p>Two.</p></chapter>',
    };
    const result = importProjectFromFiles(files);
    if ('pretextError' in result) {
      throw new Error(`unexpected error: ${result.pretextError}`);
    }
    expect(result.documentKind).toBe('book');
    expect(result.outputFiles['source/ch-intro.ptx']).toContain('Intro');
    expect(result.outputFiles['source/ch-methods.ptx']).toContain('Methods');
    expect(result.outputFiles['source/main.ptx']).toContain(
      '<xi:include href="ch-intro.ptx"/>',
    );
  });

  it('routes image assets to source/assets and .bib files to source/', () => {
    const files = {
      'main.tex':
        '\\documentclass{article}\n\\begin{document}\nHi.\n\\end{document}',
      'refs.bib': '@article{foo, title={Foo}}',
    };
    const assets = { 'diagram.png': bytes(32) };
    const result = importProjectFromFiles(files, { assets });
    if ('pretextError' in result) {
      throw new Error(`unexpected error: ${result.pretextError}`);
    }
    expect(result.outputAssets['source/assets/diagram.png']).toEqual(bytes(32));
    expect(result.outputFiles['source/refs.bib']).toContain('@article');
  });

  it('honors documentKind override option', () => {
    const files = {
      'main.tex':
        '\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}',
    };
    const result = importProjectFromFiles(files, { documentKind: 'book' });
    if ('pretextError' in result) {
      throw new Error(`unexpected error: ${result.pretextError}`);
    }
    expect(result.documentKind).toBe('book');
  });
});
