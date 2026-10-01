import { describe, expect, it } from "vitest";
import { editor } from "./spec-utils";

const typed = (marked: string, text: string) =>
  editor(marked).typeText(text).text;

describe("emphasis", () => {
  it("converts *text* to <em> on the closing *", () => {
    expect(typed("<p>|</p>", "A *big* deal")).toBe(
      "<p>A <em>big</em> deal|</p>",
    );
  });

  it("converts **text** to <alert>, not <em>, on the closing **", () => {
    expect(typed("<p>|</p>", "A **big** deal")).toBe(
      "<p>A <alert>big</alert> deal|</p>",
    );
  });

  it("waits while only the first * of a closing ** has been typed", () => {
    expect(typed("<p>|</p>", "**big*")).toBe("<p>**big*|</p>");
  });

  it("wraps multi-word content and complete inline elements", () => {
    expect(typed("<p>|</p>", "*for all $x$*")).toBe(
      "<p><em>for all <m>x</m></em>|</p>",
    );
    expect(typed("<p>|</p>", "**see *this* now**")).toBe(
      "<p><alert>see <em>this</em> now</alert>|</p>",
    );
  });

  it("leaves products and bullets alone", () => {
    expect(typed("<p>|</p>", "2*3*4")).toBe("<p>2*3*4|</p>");
    expect(typed("<p>|</p>", "a * b *")).toBe("<p>a * b *|</p>");
    expect(editor("<p>|</p>", { lists: false }).typeText("* item *").text).toBe(
      "<p>* item *|</p>",
    );
  });

  it("leaves an escaped opener alone", () => {
    expect(typed("<p>|</p>", "\\*x*")).toBe("<p>\\*x*|</p>");
  });

  it("does nothing in math, code or attributes", () => {
    expect(typed("<p><m>|</m></p>", "a *b*")).toBe("<p><m>a *b*|</m></p>");
    expect(typed("<pre>|</pre>", "*args*")).toBe("<pre>*args*|</pre>");
    expect(typed('<p xml:id="|">', "*a*")).toBe('<p xml:id="*a*|">');
  });

  it("does nothing inside a code or math span still being typed", () => {
    expect(typed("<p>|</p>", "`f(*args*")).toBe("<p>`f(*args*|</p>");
    expect(typed("<p>|</p>", "$a *b*")).toBe("<p>$a *b*|</p>");
  });

  it("does not pair across a tag", () => {
    expect(typed("<p>*a <q>|</q></p>", "b*")).toBe("<p>*a <q>b*|</q></p>");
  });
});

describe("code spans", () => {
  it("converts `text` to <c> on the closing backtick", () => {
    expect(typed("<p>|</p>", "Run `ls -a` now")).toBe(
      "<p>Run <c>ls -a</c> now|</p>",
    );
  });

  it("keeps $ and * inside a code span literal", () => {
    expect(typed("<p>|</p>", "`$x$`")).toBe("<p><c>$x$</c>|</p>");
    expect(typed("<p>|</p>", "`*args*`")).toBe("<p><c>*args*</c>|</p>");
  });

  it("leaves a fence alone", () => {
    expect(typed("<p>|</p>", "```")).toBe("<p>```|</p>");
  });
});

describe("terms and quotes", () => {
  it("converts _text_ to <term> on the space after it", () => {
    expect(typed("<p>|</p>", "A _graph_ is")).toBe(
      "<p>A <term>graph</term> is|</p>",
    );
  });

  it("waits for the space", () => {
    expect(typed("<p>|</p>", "A _graph_")).toBe("<p>A _graph_|</p>");
  });

  it('converts "text" to <q> on the space after it', () => {
    expect(typed("<p>|</p>", 'He said "hi there" twice')).toBe(
      "<p>He said <q>hi there</q> twice|</p>",
    );
  });

  it("allows punctuation between the closing delimiter and the space", () => {
    expect(typed("<p>|</p>", "a _graph_, then")).toBe(
      "<p>a <term>graph</term>, then|</p>",
    );
    expect(typed("<p>|</p>", '("quoted"). Next')).toBe(
      "<p>(<q>quoted</q>). Next|</p>",
    );
  });

  it("needs whitespace (or the start of the text) before the opener", () => {
    expect(typed("<p>|</p>", "my_var_ x")).toBe("<p>my_var_ x|</p>");
    expect(typed("<p>|</p>", "_graph_ x")).toBe("<p><term>graph</term> x|</p>");
  });

  it("needs tight content", () => {
    expect(typed("<p>|</p>", 'a " b " c')).toBe('<p>a " b " c|</p>');
    expect(typed("<p>|</p>", "a _ b_ c")).toBe("<p>a _ b_ c|</p>");
  });

  it("works with an auto-closed quote typed over", () => {
    const e = editor("<p>He said |</p>");
    // The editor auto-closed the quote: `"|"`.
    e.change({ source: '<p>He said ""</p>', caret: 12 }, [
      { rangeOffset: 11, rangeLength: 0, text: '""' },
    ]);
    e.typeText("hi").overtype('"').type(" ");
    expect(e.text).toBe("<p>He said <q>hi</q> |</p>");
  });
});

describe("links", () => {
  it("converts [text](url) to <url> on the )", () => {
    expect(typed("<p>|</p>", "See [PreTeXt](https://pretextbook.org)")).toBe(
      '<p>See <url href="https://pretextbook.org">PreTeXt</url>|</p>',
    );
  });

  it("makes an empty label a self-closing <url>", () => {
    expect(typed("<p>|</p>", "[](https://x.org)")).toBe(
      '<p><url href="https://x.org"/>|</p>',
    );
  });

  it("escapes & in the href", () => {
    expect(typed("<p>|</p>", "[q](https://x.org/?a=1&b=2)")).toBe(
      '<p><url href="https://x.org/?a=1&amp;b=2">q</url>|</p>',
    );
  });

  it("works when the brackets were auto-closed and typed over", () => {
    const e = editor("<p>|</p>");
    e.change({ source: "<p>[]</p>", caret: 4 }, [
      { rangeOffset: 3, rangeLength: 0, text: "[]" },
    ]);
    e.typeText("x").overtype("]");
    e.change({ source: "<p>[x]()</p>", caret: 7 }, [
      { rangeOffset: 6, rangeLength: 0, text: "()" },
    ]);
    e.typeText("u.org").overtype(")");
    expect(e.text).toBe('<p><url href="u.org">x</url>|</p>');
  });

  it("leaves images, spaced urls and plain parentheses alone", () => {
    expect(typed("<p>|</p>", "![a](b.png)")).toBe("<p>![a](b.png)|</p>");
    expect(typed("<p>|</p>", "[a](b c)")).toBe("<p>[a](b c)|</p>");
    expect(typed("<p>|</p>", "f(x)")).toBe("<p>f(x)|</p>");
  });
});

describe("cross-references", () => {
  it("turns @ after a space into an <xref> and asks for completions", () => {
    const e = editor("<p>By |</p>").type("@");
    expect(e.text).toBe('<p>By <xref ref="|"/></p>');
    expect(e.lastEdit).toMatchObject({ kind: "xref", suggest: true });
  });

  it("leaves email addresses and math alone", () => {
    expect(typed("<p>|</p>", "me@x.org")).toBe("<p>me@x.org|</p>");
    expect(typed("<p><m>|</m></p>", " @")).toBe("<p><m> @|</m></p>");
  });
});

describe("options", () => {
  it("turns inline markup and cross-references off", () => {
    expect(
      editor("<p>|</p>", { inlineMarkup: false }).typeText("*a* _b_ ").text,
    ).toBe("<p>*a* _b_ |</p>");
    expect(
      editor("<p>|</p>", { crossReferences: false }).type(" ", "@").text,
    ).toBe("<p> @|</p>");
  });
});
