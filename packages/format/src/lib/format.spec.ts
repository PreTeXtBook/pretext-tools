import { describe, expect, it } from 'vitest';
import { formatPretext } from './format';

describe('format', () => {
  it('should format pretext content', () => {
    const input = '<pretext>sample content</pretext>';
    const result = formatPretext(input);
    expect(result).toBeDefined();
    // Add more specific assertions based on expected behavior
  });

  it('should handle empty input', () => {
    const result = formatPretext('');
    expect(result).toBe('');
  });

  it('should not introduce a linebreak when xi:include is inline inside another tag', () => {
    const input = `    <webwork><xi:include href="test.pg" parse="text"/></webwork>`;
    const result = formatPretext(input);
    // The xi:include should remain on the same line as <webwork> and </webwork>
    expect(result).toContain(
      `<webwork><xi:include href="test.pg" parse="text"/></webwork>`,
    );
    expect(result).not.toMatch(/<webwork>\s*\n\s*<xi:include/);
    expect(result).not.toMatch(/<xi:include[^>]*\/>\s*\n\s*<\/webwork>/);
  });

  it('wraps long block start-tag attributes when enabled', () => {
    const input = `<book xml:id="my-book" audience="undergraduate" origin="A very long attribute value that should push the line over the limit"><title>Example</title></book>`;
    const result = formatPretext(input, {
      printWidth: 80,
      breakLongAttributes: true,
    });

    expect(result).toBe(
      `<book xml:id="my-book"\n      audience="undergraduate"\n      origin="A very long attribute value that should push the line over the limit">\n  <title>Example</title>\n\n</book>`,
    );
  });
});

describe('verbatim content preservation', () => {
  it('preserves trailing space in single-line verbatim (e.g. <prompt>$ </prompt>)', () => {
    const input = `<console><prompt>$ </prompt><input>ls</input></console>`;
    const result = formatPretext(input);
    expect(result).toContain('<prompt>$ </prompt>');
  });

  it('preserves leading and trailing spaces in inline <c> tags', () => {
    const input = `<p>Inline <c> x + 1 </c> with spaces.</p>`;
    const result = formatPretext(input);
    expect(result).toContain('<c> x + 1 </c>');
  });

  it('preserves intentional trailing blank line inside a program block', () => {
    const input = `<program>\ndef foo():\n    return 1\n\n</program>`;
    const result = formatPretext(input);
    // The blank line at the end of the code should survive formatting
    expect(result).toMatch(/return 1\n\n/);
  });

  it('does not alter internal whitespace or indentation in code blocks', () => {
    const code = '  line1\n    line2 indented\n  line3';
    const input = `<pre>\n${code}\n</pre>`;
    const result = formatPretext(input);
    expect(result).toContain(code);
  });

  it('preserves internal blank lines inside verbatim blocks', () => {
    const input = `<program>\nline1\n\nline3\n</program>`;
    const result = formatPretext(input);
    expect(result).toMatch(/line1\n\nline3/);
  });

  it('preserves boundary newlines in verbatim blocks', () => {
    const input = `<output>\nline\n</output>`;
    const result = formatPretext(input);
    expect(result).toBe(input);
  });
});
