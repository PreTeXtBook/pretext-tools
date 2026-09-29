import { describe, expect, it } from "vitest";
import { escapeBeforeWhitespace, escapeGreaterThan } from "./escapes";
import { applyEdit, doc, show, type } from "./spec-utils";

/** Type `text` at the caret, then apply whatever escape it completes. */
const typing = (marked: string, text: string): string | null => {
  const { doc: after, changes } = type(doc(marked), text);
  const start = changes[0].rangeOffset;
  const end = start + changes[0].text.length;
  const edit =
    text === ">"
      ? escapeGreaterThan(after.source, start)
      : escapeBeforeWhitespace(after.source, start, end);
  return edit && show(applyEdit(after.source, edit));
};

describe("escapes in text", () => {
  it("escapes < when a space follows it", () => {
    expect(typing("<p>if x <|</p>", " ")).toBe("<p>if x &lt; |</p>");
  });

  it("escapes < followed by a tab or an Enter", () => {
    expect(typing("<p>if x <|</p>", "\t")).toBe("<p>if x &lt;\t|</p>");
    expect(typing("<p>if x <|</p>", "\n")).toBe("<p>if x &lt;\n|</p>");
  });

  it("escapes < even without a space before it", () => {
    expect(typing("<p>x<|</p>", " ")).toBe("<p>x&lt; |</p>");
  });

  it("sweeps away the > Monaco auto-closes after <", () => {
    expect(typing("<p>if x <|></p>", " ")).toBe("<p>if x &lt; |</p>");
  });

  it("escapes & when whitespace follows it", () => {
    expect(typing("<p>Alice &|</p>", " ")).toBe("<p>Alice &amp; |</p>");
  });

  it("escapes > as it is typed after whitespace", () => {
    expect(typing("<p>if x |</p>", ">")).toBe("<p>if x &gt;|</p>");
  });

  it("leaves a > with no whitespace before it", () => {
    expect(typing("<p>x-|</p>", ">")).toBeNull();
  });

  it("never touches a real tag's >, even after whitespace", () => {
    expect(typing('<p xml:id="a" |', ">")).toBeNull();
  });

  it("leaves comments and attribute values alone", () => {
    expect(typing("<!-- if x <|", " ")).toBeNull();
    expect(typing("<!-- if x |", ">")).toBeNull();
    expect(typing('<p title="a <|', " ")).toBeNull();
  });
});

describe("escapes in math", () => {
  it("turns a < surrounded by spaces into \\lt", () => {
    expect(typing("<p><m>x <|</m></p>", " ")).toBe("<p><m>x \\lt |</m></p>");
  });

  it("turns a > surrounded by spaces into \\gt once the trailing space is typed", () => {
    expect(typing("<p><m>x |</m></p>", ">")).toBeNull();
    expect(typing("<p><m>x >|</m></p>", " ")).toBe("<p><m>x \\gt |</m></p>");
  });

  it("works in display math and mrow", () => {
    expect(typing("<md>\n  a <|\n</md>", "\n")).toBe(
      "<md>\n  a \\lt\n  |\n</md>",
    );
    expect(typing("<md><mrow>a >|</mrow></md>", " ")).toBe(
      "<md><mrow>a \\gt |</mrow></md>",
    );
  });

  it("sweeps away an auto-closed >", () => {
    expect(typing("<m>x <|></m>", " ")).toBe("<m>x \\lt |</m>");
  });

  it("leaves LaTeX delimiters like \\left< alone", () => {
    expect(typing("<me>\\left<| x</me>", " ")).toBeNull();
    expect(typing("<me>x \\right>|</me>", " ")).toBeNull();
  });

  it("uses &lt; in text inside display math", () => {
    expect(typing("<md><intertext>if x <|</intertext></md>", " ")).toBe(
      "<md><intertext>if x &lt; |</intertext></md>",
    );
  });
});
