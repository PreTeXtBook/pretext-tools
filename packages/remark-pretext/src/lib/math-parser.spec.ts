import { describe, it, expect } from 'vitest';
import { splitTextWithMath, tokenizeMathInMarkdown } from './math-parser.js';

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

describe('math-parser - tokenizeMathInMarkdown', () => {
  it('tokenizes inline math outside code spans', () => {
    const { markdown, tokens } = tokenizeMathInMarkdown('Let $x^2$ be a value.');
    expect(tokens.size).toBe(1);
    const [token, math] = [...tokens.entries()][0];
    expect(markdown).toContain(token);
    expect(math.value).toBe('x^2');
    expect(math.meta).toBe('inline');
  });

  it('does not tokenize $ inside a backtick code span', () => {
    const { markdown, tokens } = tokenizeMathInMarkdown('Use `$x$` here.');
    // No math tokens should be produced; the code span is copied verbatim
    expect(tokens.size).toBe(0);
    expect(markdown).toBe('Use `$x$` here.');
  });

  it('does not tokenize $ inside a fenced code block', () => {
    const { markdown, tokens } = tokenizeMathInMarkdown('```\n$x = 1$\n```');
    expect(tokens.size).toBe(0);
    expect(markdown).toBe('```\n$x = 1$\n```');
  });

  it('tokenizes math after a code span', () => {
    const { markdown, tokens } = tokenizeMathInMarkdown('`code` then $x^2$.');
    expect(tokens.size).toBe(1);
    const [, math] = [...tokens.entries()][0];
    expect(math.value).toBe('x^2');
    // The code span is preserved verbatim
    expect(markdown.startsWith('`code`')).toBe(true);
  });

  it('handles mixed code spans and math', () => {
    const { markdown, tokens } = tokenizeMathInMarkdown('Use `$a$` and also $b^2$.');
    // Only the second $ expression should be tokenized
    expect(tokens.size).toBe(1);
    const [, math] = [...tokens.entries()][0];
    expect(math.value).toBe('b^2');
    expect(markdown).toContain('`$a$`');
  });
});
