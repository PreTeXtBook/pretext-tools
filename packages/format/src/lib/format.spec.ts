import { describe, expect, it } from "vitest";
import { formatPretext } from "./format";

describe("format", () => {
  it("should format pretext content", () => {
    const input = "<pretext>sample content</pretext>";
    const result = formatPretext(input);
    expect(result).toBeDefined();
    // Add more specific assertions based on expected behavior
  });

  it("should handle empty input", () => {
    const result = formatPretext("");
    expect(result).toBe("");
  });

  it("should not introduce a linebreak when xi:include is inline inside another tag", () => {
    const input = `    <webwork><xi:include href="test.pg" parse="text"/></webwork>`;
    const result = formatPretext(input);
    // The xi:include should remain on the same line as <webwork> and </webwork>
    expect(result).toContain(
      `<webwork><xi:include href="test.pg" parse="text"/></webwork>`,
    );
    expect(result).not.toMatch(/<webwork>\s*\n\s*<xi:include/);
    expect(result).not.toMatch(/<xi:include[^>]*\/>\s*\n\s*<\/webwork>/);
  });

  it("wraps long block start-tag attributes when enabled", () => {
    const input = `<book xml:id="my-book" audience="undergraduate" origin="A very long attribute value that should push the line over the limit"><title>Example</title></book>`;
    const result = formatPretext(input, {
      printWidth: 80,
      breakLongAttributes: true,
    });

    expect(result).toBe(
      `<book xml:id="my-book"\n      audience="undergraduate"\n      origin="A very long attribute value that should push the line over the limit">\n  <title>Example</title>\n\n</book>`,
    );
  });

  // https://github.com/PreTeXtBook/pretext-tools/issues/252
  describe("<strcmp> is left verbatim", () => {
    it("does not add whitespace around the comparison string", () => {
      const input = `<test correct="yes">
  <strcmp>foo\\(\\s*\\)</strcmp>
</test>`;
      const result = formatPretext(input);

      expect(result).toContain(`<strcmp>foo\\(\\s*\\)</strcmp>`);
      expect(result).not.toMatch(/<strcmp>\s*\n/);
      expect(result).not.toMatch(/\n\s*<\/strcmp>/);
    });

    it("preserves surrounding whitespace the author wrote", () => {
      const input = `<test><strcmp strip="no"> padded </strcmp></test>`;
      const result = formatPretext(input);

      expect(result).toContain(`<strcmp strip="no"> padded </strcmp>`);
    });

    it("still self-closes an empty strcmp", () => {
      const input = `<test correct="yes"><strcmp use-answer="yes"/></test>`;
      const result = formatPretext(input);

      expect(result).toContain(`<strcmp use-answer="yes"/>`);
    });

    it("is idempotent", () => {
      const input = `<test correct="yes">
  <strcmp>foo\\(\\s*\\)</strcmp>
</test>`;
      const once = formatPretext(input);

      expect(formatPretext(once)).toBe(once);
    });
  });

  describe("code-carrying elements are left verbatim", () => {
    it("preserves relative indentation in <mermaid>", () => {
      const input = `<image><mermaid>graph TD\n  A --> B\n    B --> C</mermaid></image>`;
      const result = formatPretext(input);

      // Mermaid is indentation-sensitive: re-indenting only the first line would
      // destroy the relationship between the lines.
      expect(result).toContain(
        `<mermaid>graph TD\n  A --&gt; B\n    B --&gt; C</mermaid>`,
      );
    });

    it("preserves leading whitespace in <stdin>", () => {
      const input = `<program><input>x = input()</input><stdin>  padded\nsecond</stdin></program>`;
      const result = formatPretext(input);

      expect(result).toContain(`<stdin>  padded\nsecond</stdin>`);
    });

    it.each([
      ["jscmp", `<test><jscmp>a === "  x  "</jscmp></test>`],
      [
        "setupScript",
        `<interactive><setupScript>let a = 1;\nlet b = 2;</setupScript></interactive>`,
      ],
      [
        "postRenderScript",
        `<interactive><postRenderScript>doIt();</postRenderScript></interactive>`,
      ],
      [
        "asymptote-preamble",
        `<docinfo><asymptote-preamble>size(6cm);\nimport graph;</asymptote-preamble></docinfo>`,
      ],
      ["source", `<interactive><source>a  b</source></interactive>`],
      [
        "config-json",
        `<interactive><setup><config-json>{ "a":  1 }</config-json></setup></interactive>`,
      ],
      [
        "program-preamble",
        `<exercise><program-preamble>import sys\nx = 1</program-preamble></exercise>`,
      ],
      [
        "program-postamble",
        `<exercise><program-postamble>  print(x)</program-postamble></exercise>`,
      ],
    ])("does not re-indent the contents of <%s>", (tag, input) => {
      const result = formatPretext(input);

      expect(result).not.toMatch(new RegExp(`<${tag}>\\s*\\n`));
      expect(result).not.toMatch(new RegExp(`\\n\\s*</${tag}>`));
      expect(formatPretext(result)).toBe(result);
    });

    it("keeps inline <pf> from forcing a paragraph to split", () => {
      const input = `<p>Call <pf language="python">foo(  )</pf> now.</p>`;
      const result = formatPretext(input);

      // <pf> is inline verbatim like <c>; it must not be treated as a block child.
      expect(result).toContain(`Call <pf language="python">foo(  )</pf> now.`);
    });
  });

  describe("verbatim content is never dropped", () => {
    it.each(["program", "pre", "latex-image", "jscmp"])(
      "keeps XML comments inside <%s>",
      (tag) => {
        const input = `<${tag}><!-- keep me -->body</${tag}>`;

        expect(formatPretext(input)).toContain("<!-- keep me -->");
      },
    );

    it("keeps CDATA alongside a comment", () => {
      const input = `<jscmp><!-- why --><![CDATA[a < b]]></jscmp>`;
      const result = formatPretext(input);

      expect(result).toContain("<!-- why -->");
      expect(result).toContain("<![CDATA[a < b]]>");
    });
  });

  describe("short metadata values stay on one line", () => {
    it.each([
      ["ISBN", `<biblio><ISBN>978-0-000-00000-0</ISBN></biblio>`],
      ["pages", `<biblio><pages>12-34</pages></biblio>`],
      ["email", `<author><email>someone@example.com</email></author>`],
      [
        "rename",
        `<docinfo><rename element="theorem">Teorema</rename></docinfo>`,
      ],
    ])("keeps <%s> inline with its value", (tag, input) => {
      const result = formatPretext(input);

      expect(result).not.toMatch(new RegExp(`<${tag}[^>]*>\\s*\\n`));
    });
  });
});

describe("verbatim content preservation", () => {
  it("preserves trailing space in single-line verbatim (e.g. <prompt>$ </prompt>)", () => {
    const input = `<console><prompt>$ </prompt><input>ls</input></console>`;
    const result = formatPretext(input);
    expect(result).toContain("<prompt>$ </prompt>");
  });

  it("preserves leading and trailing spaces in inline <c> tags", () => {
    const input = `<p>Inline <c> x + 1 </c> with spaces.</p>`;
    const result = formatPretext(input);
    expect(result).toContain("<c> x + 1 </c>");
  });

  it("preserves intentional trailing blank line inside a program block", () => {
    const input = `<program>\ndef foo():\n    return 1\n\n</program>`;
    const result = formatPretext(input);
    // The blank line at the end of the code should survive formatting
    expect(result).toMatch(/return 1\n\n/);
  });

  it("does not alter internal whitespace or indentation in code blocks", () => {
    const code = "  line1\n    line2 indented\n  line3";
    const input = `<pre>\n${code}\n</pre>`;
    const result = formatPretext(input);
    expect(result).toContain(code);
  });

  it("preserves internal blank lines inside verbatim blocks", () => {
    const input = `<program>\nline1\n\nline3\n</program>`;
    const result = formatPretext(input);
    expect(result).toMatch(/line1\n\nline3/);
  });

  it("preserves boundary newlines in verbatim blocks", () => {
    const input = `<output>\nline\n</output>`;
    const result = formatPretext(input);
    expect(result).toBe(input);
  });
});
