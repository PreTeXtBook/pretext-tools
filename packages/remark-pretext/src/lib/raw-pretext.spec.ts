import { describe, expect, it } from "vitest";
import { markdownToPretext } from "../index.js";

describe("raw PreTeXt inline", () => {
  it.each([
    [
      'A <url href="https://ex.com">link</url> here and $x$.',
      '<p>A <url href="https://ex.com">link</url> here and <m>x</m>.</p>',
    ],
    ['See <xref ref="a"/>.', '<p>See <xref ref="a"/>.</p>'],
    ["Word<idx>word</idx> here.", "<p>Word<idx>word</idx> here.</p>"],
    [
      "A <fn>outer <fn>inner</fn> rest</fn> b.",
      "<p>A <fn>outer <fn>inner</fn> rest</fn> b.</p>",
    ],
  ])("becomes an element: %s", (markdown, xml) => {
    expect(markdownToPretext(markdown)).toBe(xml);
  });

  it("converts Markdown between a pair of tags", () => {
    expect(markdownToPretext("A<fn>about *this* and $x$</fn> b.")).toBe(
      "<p>A<fn>about <em>this</em> and <m>x</m></fn> b.</p>",
    );
  });

  it.each([
    ["Raw <m>a*b*c</m> here.", "<p>Raw <m>a*b*c</m> here.</p>"],
    ["Raw <c>*x*</c> here.", "<p>Raw <c>*x*</c> here.</p>"],
    ["Raw <c>$x$</c> here.", "<p>Raw <c>$x$</c> here.</p>"],
    ["Then <me>a*b*c</me> done.", "<p>Then <me>a*b*c</me> done.</p>"],
  ])("leaves LaTeX and code alone: %s", (markdown, xml) => {
    expect(markdownToPretext(markdown)).toBe(xml);
  });

  it.each([
    [
      '<url href="https://ex.com/a$b">text $x$</url> and $y$',
      '<p><url href="https://ex.com/a$b">text <m>x</m></url> and <m>y</m></p>',
    ],
    [
      '<url href="https://ex.com/$b$">text</url>',
      '<p><url href="https://ex.com/$b$">text</url></p>',
    ],
  ])("keeps a $ in an attribute: %s", (markdown, xml) => {
    expect(markdownToPretext(markdown)).toBe(xml);
  });

  it.each([
    ["an unclosed tag", 'A <url href="x">link here.', 1],
    ["a stray closing tag", "A </url> here.", 1],
    ["crossed tags", "A <em>x <alert>y</em> z</alert> b.", 2],
    ["unparsable content", "Raw <m>x < y</m> here.", 2],
    ["HTML", "Line<br>two.", 1],
    ["an unknown element", "A <blink>tag</blink> here.", 2],
    ["a processing instruction", "A <?foo bar?> here.", 1],
  ])("flags %s", (_name, markdown, count) => {
    const xml = markdownToPretext(markdown);
    expect(xml.match(/<TODO /g)).toHaveLength(count);
  });

  it("is not raw PreTeXt inside code", () => {
    expect(markdownToPretext('Use `<xref ref="a"/>` here.')).toBe(
      '<p>Use <c>&#x3C;xref ref="a"/></c> here.</p>',
    );
  });
});

describe("raw PreTeXt blocks", () => {
  it("passes a block through as elements", () => {
    expect(
      markdownToPretext(
        '<sidebyside>\n<image source="a.png"/>\n</sidebyside>\n\nAfter.',
      ),
    ).toBe('<sidebyside>\n<image source="a.png"/>\n</sidebyside><p>After.</p>');
  });

  it("keeps xml:id and other attributes", () => {
    expect(markdownToPretext('<image xml:id="i" source="a.png"/>')).toBe(
      '<image xml:id="i" source="a.png"/>',
    );
  });

  it("runs through blank lines to the closing tag", () => {
    expect(
      markdownToPretext(
        '<figure>\n<caption>Cap</caption>\n\n<image source="a.png"/>\n</figure>\n\nAfter.',
      ),
    ).toBe(
      '<figure>\n<caption>Cap</caption>\n\n<image source="a.png"/>\n</figure><p>After.</p>',
    );
  });

  it("keeps code with blank lines and indentation intact", () => {
    const code =
      '<program>\n<input>\ndef f():\n\n    return "a"\n</input>\n</program>';
    expect(markdownToPretext(code)).toBe(code);
  });

  it("doesn't read anything inside as Markdown", () => {
    expect(
      markdownToPretext(
        "# One\n\n<section>\n<title>A $x$</title>\n\n# Not a heading\n\n</section>",
      ),
    ).toBe(
      "<chapter><title>One</title><section>\n<title>A $x$</title>\n\n# Not a heading\n\n</section></chapter>",
    );
  });

  it("closes a block on the matching tag, not an inner one of the same name", () => {
    const xml =
      "<task>\n<task>\n<statement><p>a</p></statement>\n\n</task>\n\n</task>";
    expect(markdownToPretext(`${xml}\n\nAfter.`)).toBe(`${xml}<p>After.</p>`);
  });

  it.each([
    ['<xref ref="a"/>', '<p><xref ref="a"/></p>'],
    ['<xref ref="a"/>\nis good.', '<p><xref ref="a"/>\nis good.</p>'],
    ["<me>\nx\n</me>", "<p><me>\nx\n</me></p>"],
    ['- <xref ref="a"/>', '<ul><li><p><xref ref="a"/></p></li></ul>'],
    ['> <xref ref="a"/>', '<blockquote><p><xref ref="a"/></p></blockquote>'],
  ])("wraps what can only be in a paragraph: %s", (markdown, xml) => {
    expect(markdownToPretext(markdown)).toBe(xml);
  });

  it("sits among Markdown in a directive", () => {
    expect(
      markdownToPretext(
        ':::theorem\n<image source="a.png"/>\n\nText $x$.\n:::',
      ),
    ).toBe(
      '<theorem><statement><image source="a.png"/><p>Text <m>x</m>.</p></statement></theorem>',
    );
  });

  it("decodes and re-encodes entities", () => {
    expect(markdownToPretext("<p>a &lt; b</p>")).toBe("<p>a &#x3C; b</p>");
  });

  it.each([
    ["an unclosed block", "<figure>\n\nText."],
    ["a stray closing tag", "Text.\n\n</figure>"],
    ["HTML", "<div>hello</div>"],
    ["an undefined entity", "<p>a&nbsp;b</p>"],
    ["a processing instruction", "<?foo bar?>"],
  ])("flags %s, keeping the source", (_name, markdown) => {
    const xml = markdownToPretext(markdown);
    expect(xml).toContain('<TODO type="unknown-block-type">');
  });
});

describe("comments", () => {
  it.each([
    ["a block", "<!-- a comment -->\n\nBody.", "<p>Body.</p>"],
    ["inline", "Some<!-- a comment --> text.", "<p>Some text.</p>"],
    ["with blank lines", "<!-- a\n\nb\n-->\n\nBody.", "<p>Body.</p>"],
    ["with dashes", "<!-- a -- b -->\n\nBody.", "<p>Body.</p>"],
    ["with a $", "<!-- $5 and $x$ -->\n\nBody.", "<p>Body.</p>"],
    [
      "in a raw block",
      '<figure><!-- x --><image source="a"/></figure>',
      '<figure><image source="a"/></figure>',
    ],
  ])("drops a comment: %s", (_name, markdown, xml) => {
    expect(markdownToPretext(markdown)).toBe(xml);
  });

  it("doesn't leave an empty introduction behind", () => {
    expect(markdownToPretext("<!-- draft -->\n\n# Title\n\nBody.")).toBe(
      "<chapter><title>Title</title><p>Body.</p></chapter>",
    );
  });

  it("flags an unterminated comment rather than losing the document", () => {
    expect(markdownToPretext("<!-- oops\n\nBody.")).toContain("Body.");
  });
});
