import { describe, expect, it } from 'vitest';
import {
  splitLatexAtDocument,
  extractLatexField,
  extractMacros,
  extractPreambleInfo,
} from './latex-preamble';

describe('splitLatexAtDocument', () => {
  it('splits at \\begin{document}', () => {
    const src =
      '\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}';
    const { preamble, body } = splitLatexAtDocument(src);
    expect(preamble).toBe('\\documentclass{article}');
    expect(body).toBe('Hello.');
  });

  it('returns empty preamble and full source when no \\begin{document}', () => {
    const src = 'Just some content.';
    const { preamble, body } = splitLatexAtDocument(src);
    expect(preamble).toBe('');
    expect(body).toBe('Just some content.');
  });

  it('strips content after \\end{document}', () => {
    const src = '\\begin{document}\nBody.\n\\end{document}\nTrailing.';
    const { body } = splitLatexAtDocument(src);
    expect(body).toBe('Body.');
    expect(body).not.toContain('Trailing');
  });

  it('handles missing \\end{document}', () => {
    const src = '\\begin{document}\nBody without end.';
    const { body } = splitLatexAtDocument(src);
    expect(body).toBe('Body without end.');
  });
});

describe('extractLatexField', () => {
  it('extracts simple title', () => {
    expect(extractLatexField('\\title{My Title}', 'title')).toBe('My Title');
  });

  it('skips optional argument', () => {
    expect(extractLatexField('\\title[Short]{Long Title}', 'title')).toBe(
      'Long Title',
    );
  });

  it('returns empty string when command not present', () => {
    expect(extractLatexField('\\documentclass{article}', 'title')).toBe('');
  });

  it('extracts author', () => {
    expect(extractLatexField('\\author{Oscar Levin}', 'author')).toBe(
      'Oscar Levin',
    );
  });

  it('handles nested braces in field content', () => {
    expect(
      extractLatexField('\\title{A Book About \\textbf{Math}}', 'title'),
    ).toBe('A Book About \\textbf{Math}');
  });

  it('does not match prefix of longer command', () => {
    // \titlepage should not match \title
    expect(extractLatexField('\\titlepage\\title{Real}', 'title')).toBe('Real');
  });
});

describe('extractMacros', () => {
  it('collects \\newcommand lines', () => {
    const preamble =
      '\\usepackage{amsmath}\n\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\ZZ}{\\mathbb{Z}}';
    const macros = extractMacros(preamble);
    expect(macros).toContain('\\newcommand{\\R}{\\mathbb{R}}');
    expect(macros).toContain('\\newcommand{\\ZZ}{\\mathbb{Z}}');
    expect(macros).not.toContain('\\usepackage');
  });

  it('collects \\renewcommand', () => {
    const preamble = '\\renewcommand{\\vec}[1]{\\mathbf{#1}}';
    expect(extractMacros(preamble)).toContain('\\renewcommand');
  });

  it('collects \\DeclareMathOperator', () => {
    const preamble = '\\DeclareMathOperator{\\Hom}{Hom}';
    expect(extractMacros(preamble)).toContain('\\DeclareMathOperator');
  });

  it('collects multi-line \\newcommand', () => {
    const preamble = '\\newcommand{\\myfrac}[2]{\n  \\frac{#1}{#2}\n}';
    const macros = extractMacros(preamble);
    expect(macros).toContain('\\newcommand{\\myfrac}');
    expect(macros).toContain('\\frac{#1}{#2}');
  });

  it('returns empty string when no macros present', () => {
    const preamble = '\\documentclass{article}\n\\usepackage{amsmath}';
    expect(extractMacros(preamble)).toBe('');
  });
});

describe('extractPreambleInfo', () => {
  it('extracts title, author, and macros together', () => {
    const preamble = [
      '\\documentclass{book}',
      '\\title{My Book}',
      '\\author{Oscar Levin}',
      '\\newcommand{\\R}{\\mathbb{R}}',
    ].join('\n');

    const info = extractPreambleInfo(preamble);
    expect(info.title).toBe('My Book');
    expect(info.author).toBe('Oscar Levin');
    expect(info.macros).toContain('\\newcommand{\\R}');
  });

  it('ignores commented-out commands', () => {
    const preamble = '% \\title{Fake}\n\\title{Real}';
    expect(extractPreambleInfo(preamble).title).toBe('Real');
  });

  it('returns empty strings when nothing found', () => {
    const info = extractPreambleInfo('\\documentclass{article}');
    expect(info.title).toBe('');
    expect(info.author).toBe('');
    expect(info.macros).toBe('');
  });
});
