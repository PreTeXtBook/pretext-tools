import { describe, expect, it } from 'vitest';
import { cleanLatex } from './clean-latex';

describe('cleanLatex', () => {
  it('runs the full pipeline on a small document', () => {
    const input = [
      '\\documentclass{article}',
      '% throwaway comment',
      '\\begin{document}',
      '{\\bf hello} \\smallskip world',
      'see (\\ref{eq_foo})',
      '\\end{document}',
    ].join('\n');

    const { output, warnings } = cleanLatex(input);

    expect(output).toContain('\\textbf{hello}');
    expect(output).toContain('\\eqref{eq_foo}');
    expect(output).not.toContain('\\smallskip');
    expect(output).not.toContain('% throwaway');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('collapses runs of blank lines', () => {
    const { output } = cleanLatex('a\n\n\n\n\nb');
    expect(output).not.toMatch(/\n{3,}/);
  });
});
