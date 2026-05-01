import { describe, it, expect } from 'vitest';
import { splitTextWithMath } from './math-parser.js';

describe('math-parser - splitTextWithMath', () => {
  it('finds LaTeX \\[ \\] delimiters', () => {
    const result = splitTextWithMath('\\[a^2\\]');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('math');
    expect(result[0].value).toBe('a^2');
    expect(result[0].meta).toBe('display');
  });

  it('finds LaTeX \\( \\) delimiters', () => {
    const result = splitTextWithMath('text \\(x^2\\) more');
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('text');
    expect(result[1].type).toBe('math');
    expect(result[1].value).toBe('x^2');
    expect(result[1].meta).toBe('inline');
  });

  it('finds $$ delimiters', () => {
    const result = splitTextWithMath('$$a^2$$');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('math');
    expect(result[0].value).toBe('a^2');
  });

  it('finds $ delimiters', () => {
    const result = splitTextWithMath('text $x^2$ more');
    expect(result).toHaveLength(3);
    expect(result[1].type).toBe('math');
    expect(result[1].value).toBe('x^2');
    expect(result[1].meta).toBe('inline');
  });

  it('handles text without math', () => {
    const result = splitTextWithMath('just text');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].value).toBe('just text');
  });
});
