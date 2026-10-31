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

describe("whitespace around inline elements", () => {
  const body = (input: string) =>
    formatPretext(`<p>${input}</p>`).split("\n")[1].trim();

  it.each([
    ["closing paren", `(for example, <m>x</m>)`],
    ["opening paren", `(<m>x</m>) and (<xref ref="a"/>)`],
    ["brackets and braces", `[<m>x</m>] and {<m>y</m>}`],
    ["quotes", `"<em>quoted</em>"`],
    ["possessive and plural", `the <m>x</m>'s and <m>y</m>s`],
    ["a word split by markup", `un<em>believ</em>able`],
    ["hyphenated compounds", `<m>L</m>-functions and pre-<m>x</m>`],
    ["touching elements", `<em>a</em><m>b</m>`],
    ["a comment inside a word", `a<!-- c -->b`],
  ])("adds no whitespace: %s", (_, input) => {
    expect(body(input)).toBe(input);
  });

  it.each([
    ["between elements", `<m>a</m> <m>b</m>`],
    ["a spaced hyphen", `<m>x</m> - y`],
    ["around a comment", `a <!-- c --> b`],
  ])("removes no whitespace: %s", (_, input) => {
    expect(body(input)).toBe(input);
  });

  it("keeps separated elements apart in a <p> with a block child", () => {
    const input = `<p><m>a</m> <m>b</m><md><mrow>x</mrow></md><m>c</m> <m>d</m></p>`;
    const result = formatPretext(input);

    expect(result).toContain("<m>a</m> <m>b</m>");
    expect(result).toContain("<m>c</m> <m>d</m>");
  });

  it("keeps separated elements apart at the top level of a fragment", () => {
    expect(formatPretext(`<m>a</m> <m>b</m>`)).toBe(`<m>a</m> <m>b</m>`);
  });

  it("applies to smart paragraphs and unwrapped fragments", () => {
    expect(formatPretext(`<title>Foo (<m>x</m>)</title>`)).toBe(
      `<title>Foo (<m>x</m>)</title>`,
    );
    expect(formatPretext(`(<m>x</m>)`)).toBe(`(<m>x</m>)`);
  });

  it("still pulls sentence punctuation back across whitespace", () => {
    expect(body(`<m>x</m>\n, we have`)).toBe(`<m>x</m>, we have`);
  });

  it("does not wrap between a closing tag and its punctuation", () => {
    const filler = "word ".repeat(14).trim();
    const lines = formatPretext(`<p>${filler} (see <m>x + y</m>).</p>`, {
      printWidth: 80,
    }).split("\n");

    expect(lines).toContain("  <m>x + y</m>).");
  });

  it("fuses closing punctuation onto display math", () => {
    const input = `<p>Note (see<md><mrow>x</mrow></md>). Next.</p>`;
    const result = formatPretext(input);

    expect(result).toContain("</md>).\n  Next.");
    expect(formatPretext(result)).toBe(result);
  });

  it("is idempotent", () => {
    const once = formatPretext(
      `<p>(<m>x</m>) the <m>y</m>'s, <em>a</em><m>b</m> <m>c</m> - d</p>`,
    );

    expect(formatPretext(once)).toBe(once);
  });
});

describe("content the serializer must not drop", () => {
  it.each([
    ["between inline runs", `<p>a <?pi x?> b</p>`],
    ["inside an inline element", `<p>a <em>b <?pi x?> c</em> d</p>`],
    ["inside a <title>", `<title>A <?pi x?> B</title>`],
    ["inside a verbatim block", `<program><?pi x?>code</program>`],
  ])("keeps a processing instruction %s", (_, input) => {
    const result = formatPretext(input);

    expect(result).toContain("<?pi x?>");
    expect(formatPretext(result)).toBe(result);
  });

  it("keeps <?xml-model?> after the XML declaration", () => {
    const input = `<?xml version="1.0"?>\n<?xml-model href="x.rng"?>\n<pretext><p>hi</p></pretext>`;

    expect(formatPretext(input)).toBe(
      `<?xml version="1.0"?>\n\n<?xml-model href="x.rng"?>\n<pretext>\n  <p>\n    hi\n  </p>\n</pretext>`,
    );
  });

  it("indents a processing instruction between blocks", () => {
    const result = formatPretext(`<section><?pi x?><p>a</p></section>`);

    expect(result).toContain("\n  <?pi x?>\n");
  });

  it.each([
    ["in a <p>", `<p>a <![CDATA[x<y]]> b</p>`],
    ["touching text", `<p>a<![CDATA[x<y]]>b</p>`],
    ["in a <title>", `<title>a <![CDATA[x<y]]> b</title>`],
  ])("keeps CDATA %s", (_, input) => {
    const result = formatPretext(input);

    expect(result).toContain("<![CDATA[x<y]]>");
    expect(formatPretext(result)).toBe(result);
  });

  it("keeps CDATA from gaining whitespace against its neighbors", () => {
    expect(formatPretext(`<p>a<![CDATA[x<y]]>b</p>`)).toContain(
      "a<![CDATA[x<y]]>b",
    );
  });
});

describe("top-level comments", () => {
  const doc = `<pretext><p>hi</p></pretext>`;

  it("keeps consecutive comments before the root on their own lines", () => {
    const result = formatPretext(`<!-- a -->\n<!-- b -->\n${doc}`);

    expect(result.split("\n").slice(0, 3)).toEqual([
      "<!-- a -->",
      "<!-- b -->",
      "<pretext>",
    ]);
  });

  it("keeps comments and instructions apart after an XML declaration", () => {
    const result = formatPretext(
      `<?xml version="1.0"?>\n<!-- a -->\n<?pi x?>\n<!-- b -->\n${doc}`,
    );

    expect(result.split("\n").slice(2, 5)).toEqual([
      "<!-- a -->",
      "<?pi x?>",
      "<!-- b -->",
    ]);
    expect(formatPretext(result)).toBe(result);
  });

  it("keeps a comment after the root on its own line", () => {
    expect(formatPretext(`${doc}\n<!-- end -->`)).toMatch(
      /<\/pretext>\n<!-- end -->$/,
    );
  });

  it("still flows a comment beside loose prose in a fragment", () => {
    const input = `loose text <!-- c --> more text`;

    expect(formatPretext(input)).toBe(input);
  });
});

describe("mixed content outside paragraphs", () => {
  const raw = (body: string) => `<biblio type="raw">${body}</biblio>`;

  it("keeps a raw <biblio> flowing as prose", () => {
    const input = raw(
      `Knuth, D. <title>TAOCP</title>. 3rd ed. (<year>1997</year>)`,
    );

    expect(formatPretext(input)).toBe(
      `<biblio type="raw">\n  Knuth, D. <title>TAOCP</title>. 3rd ed. (<year>1997</year>)\n</biblio>`,
    );
  });

  it("repairs a raw <biblio> laid out by an earlier version", () => {
    const input = `<biblio type="raw">
  Knuth, D.
  <title>
    A very long title
    that used to wrap
  </title>
  . 3rd ed.
</biblio>`;

    expect(formatPretext(input)).toBe(
      `<biblio type="raw">\n  Knuth, D. <title>A very long title that used to wrap</title>. 3rd ed.\n</biblio>`,
    );
  });

  it("keeps a <note> in a raw <biblio> as a block", () => {
    const result = formatPretext(
      raw(`Knuth, D. <title>T</title>.<note><p>Classic.</p></note>`),
    );

    expect(result).toContain("<title>T</title>.\n  <note>\n");
  });

  it("leaves an element-only <biblio> in block layout", () => {
    const input = `<biblio type="bibtex"><title>T</title><year>1997</year></biblio>`;

    expect(formatPretext(input)).toBe(
      `<biblio type="bibtex">\n  <title>T</title>\n\n  <year>1997</year>\n</biblio>`,
    );
  });

  it.each([
    ["intertext", `<md><intertext>so (<m>x</m>)</intertext></md>`],
    ["feedback", `<choice><feedback>so (<m>x</m>)</feedback></choice>`],
    ["author", `<biblio><author>so (<m>x</m>)</author></biblio>`],
    ["pubnote", `<biblio><pubnote>so (<m>x</m>)</pubnote></biblio>`],
  ])("does not split <%s> at inline boundaries", (_, input) => {
    const result = formatPretext(input);

    expect(result).toContain("so (<m>x</m>)");
    expect(formatPretext(result)).toBe(result);
  });

  it("removes the padding an earlier version added inside <m>", () => {
    const input = `<choice><feedback>so\n  <m>\n    x\n  </m>\n  )</feedback></choice>`;

    expect(formatPretext(input)).toContain("so <m>x</m> )");
  });

  it("does not reflow display math mixed with markup", () => {
    const input = `<me>a % comment\nb <fillin/></me>`;

    expect(formatPretext(input)).toContain("a % comment\nb");
  });

  it("keeps the line breaks in <m> when unexpanding", () => {
    const input = `<feedback>so <m>\n  a % comment\n  b\n</m></feedback>`;

    expect(formatPretext(`<choice>${input}</choice>`)).toMatch(
      /<m>a % comment\n\s*b<\/m>/,
    );
  });

  it("leaves a <section> with stray text in block layout", () => {
    const result = formatPretext(
      `<section><title>T</title>stray <m>x</m><p>a</p></section>`,
    );

    expect(result).toContain("  <title>T</title>\n");
  });

  it("does not touch verbatim content in mixed content", () => {
    const input = `<note>see <c>a\n  b</c></note>`;

    expect(formatPretext(input)).toContain("<c>a\n  b</c>");
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

describe("unwrapped fragment formatting", () => {
  // A selection formatted on its own (e.g. paste-and-convert) is often prose
  // that will be re-inserted into an existing <p>, so loose top-level text and
  // inline elements like <m> should reflow together exactly as they would
  // inside a <p>, rather than each inline element being expanded like a block.
  it("reflows loose text and <m> together instead of breaking <m> onto its own lines", () => {
    const input = `We know that <m>x^2 + y^2 = z^2</m> is the Pythagorean theorem.`;
    const result = formatPretext(input);
    expect(result).not.toMatch(/<m>\n/);
    expect(result).toBe(
      "We know that <m>x^2 + y^2 = z^2</m> is the Pythagorean theorem.",
    );
  });

  it("wraps a long run of loose text and <m> at printWidth, same as inside a <p>", () => {
    const input = `We know that <m>x^2 + y^2 = z^2</m> is the Pythagorean theorem, and also <m>a^2</m> is a square.`;
    const result = formatPretext(input);
    const wrappedInsideP = formatPretext(`<p>${input}</p>`)
      .split("\n")
      .slice(1, -1)
      .map((line) => line.replace(/^ {2}/, ""))
      .join("\n");
    expect(result).toBe(wrappedInsideP);
  });

  it("keeps a short inline fragment on one line", () => {
    const input = `See <m>x^2</m> above.`;
    const result = formatPretext(input);
    expect(result).toBe("See <m>x^2</m> above.");
  });

  it("still formats multiple top-level block elements independently", () => {
    const input = `<p>First.</p><p>Second.</p>`;
    const result = formatPretext(input);
    expect(result).toBe("<p>\n  First.\n</p>\n\n<p>\n  Second.\n</p>");
  });

  it("still normalizes whitespace in a bare top-level <title>", () => {
    const input = `<title>This\n    is my title</title>`;
    const result = formatPretext(input);
    expect(result).toBe("<title>This is my title</title>");
  });

  it("alternates inline runs and a top-level block child", () => {
    const input = `Before text.<md><mrow>x</mrow></md>After text.`;
    const result = formatPretext(input);
    expect(result).toBe(
      "Before text.\n<md>\n  <mrow>x</mrow>\n</md>\nAfter text.",
    );
  });
});

// Every element the schema allows as a document root must be recognized as a
// block; otherwise a bare root is treated as one inline token and left as-is.
describe("schema root elements", () => {
  it.each(["slideshow", "handout", "exercises", "subexercises", "glossary"])(
    "formats a bare <%s> root",
    (root) => {
      const result = formatPretext(
        `<${root}><title>T</title><p>Hi.</p></${root}>`,
      );
      expect(result).toBe(
        `<${root}>\n  <title>T</title>\n\n  <p>\n    Hi.\n  </p>\n</${root}>`,
      );
    },
  );

  it("formats a slideshow with sections, slides, and subslides", () => {
    const input = `<slideshow><title>Talk</title><section><title>Intro</title><slide><title>First</title><p>One.</p><subslide><p>Two.</p></subslide></slide><slide><p>Three.</p></slide></section></slideshow>`;
    expect(formatPretext(input)).toBe(
      [
        "<slideshow>",
        "  <title>Talk</title>",
        "",
        "  <section>",
        "    <title>Intro</title>",
        "",
        "    <slide>",
        "      <title>First</title>",
        "",
        "      <p>",
        "        One.",
        "      </p>",
        "",
        "      <subslide>",
        "        <p>",
        "          Two.",
        "        </p>",
        "      </subslide>",
        "    </slide>",
        "",
        "    <slide>",
        "      <p>",
        "        Three.",
        "      </p>",
        "    </slide>",
        "  </section>",
        "</slideshow>",
      ].join("\n"),
    );
  });
});
