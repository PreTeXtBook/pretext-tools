import { describe, expect, it } from "vitest";
import {
  findLineMathMatch,
  isMathDelimiterContext,
  mathDelimiterEdit,
} from "./math-delimiters";
import { applyEdit, show } from "./spec-utils";

// Ported from pretext-plus's mathAutoConvert tests.
describe("findLineMathMatch", () => {
  it("converts a basic inline span", () => {
    const line = "The value $x^2$ end";
    const column = line.indexOf("$", line.indexOf("$") + 1) + 2;
    expect(findLineMathMatch(line, column)).toEqual({
      startColumn: line.indexOf("$") + 1,
      endColumn: column,
      replacement: "<m>x^2</m>",
    });
  });

  it("converts a basic display span", () => {
    const line = "$$\\int f$$";
    expect(findLineMathMatch(line, line.length + 1)).toEqual({
      startColumn: 1,
      endColumn: line.length + 1,
      replacement: "<md>\\int f</md>",
    });
  });

  it("does not match while only the opening $$ has been typed", () => {
    expect(findLineMathMatch("$$", 3)).toBeNull();
  });

  it("does not fire on the intermediate state before $$ closes", () => {
    expect(findLineMathMatch("$$x$", 5)).toBeNull();
  });

  it("prefers display over inline once the closing $$ completes", () => {
    expect(findLineMathMatch("$$x$$", 6)).toEqual({
      startColumn: 1,
      endColumn: 6,
      replacement: "<md>x</md>",
    });
  });

  it("does not match an escaped opener", () => {
    const line = "\\$5\\$";
    expect(findLineMathMatch(line, line.length + 1)).toBeNull();
  });

  it("does not search back across a tag boundary on the same line", () => {
    const line = '<p title="a">a</p> $x$';
    const closer = line.lastIndexOf("$") + 1;
    expect(findLineMathMatch(line, closer + 1)?.replacement).toBe("<m>x</m>");
  });

  it("rejects an empty inline span", () => {
    expect(findLineMathMatch("$$", 2)).toBeNull();
  });

  it("does not treat an unrelated $ as closing an earlier inline mention", () => {
    const line = "Tickets cost $5 or $10.";
    const secondDollar = line.indexOf("$", line.indexOf("$") + 1);
    expect(findLineMathMatch(line, secondDollar + 2)).toBeNull();
  });

  it("does not treat an unrelated $$ as closing an earlier display mention", () => {
    const line = "Tickets cost $$5 or $$10.";
    expect(findLineMathMatch(line, line.indexOf("$$10") + 3)).toBeNull();
  });

  it("still converts when the content merely contains interior whitespace", () => {
    const line = "$x + y$";
    expect(findLineMathMatch(line, line.length + 1)?.replacement).toBe(
      "<m>x + y</m>",
    );
  });
});

describe("isMathDelimiterContext", () => {
  it("is true in ordinary body text", () => {
    const source = "<p>The value $x^2 here</p>";
    expect(isMathDelimiterContext(source, source.indexOf("$"))).toBe(true);
  });

  it.each([
    "m",
    "md",
    "me",
    "men",
    "mdn",
    "mrow",
    "c",
    "cd",
    "program",
    "sage",
    "pre",
    "console",
    "latex-image",
  ])("is false inside <%s>", (tag) => {
    const source = `<${tag}>content $ here</${tag}>`;
    expect(isMathDelimiterContext(source, source.indexOf("$"))).toBe(false);
  });

  it("is false inside a comment or attribute value", () => {
    expect(isMathDelimiterContext("<!-- $x -->", 5)).toBe(false);
    const source = '<p title="cost $5">text</p>';
    expect(isMathDelimiterContext(source, source.indexOf("$"))).toBe(false);
  });

  it("recovers once a suppressing element closes", () => {
    const source = "<pre>code $ here</pre> more $ text";
    expect(isMathDelimiterContext(source, source.lastIndexOf("$"))).toBe(true);
  });
});

describe("mathDelimiterEdit", () => {
  const typedDollar = (source: string) => {
    const edit = mathDelimiterEdit(source, source.length - 1);
    return edit && show(applyEdit(source, edit));
  };

  it("converts $x$ with the caret after </m>", () => {
    expect(typedDollar("<p>The value $x$")).toBe("<p>The value <m>x</m>|");
  });

  it("converts $$x$$ to <md>", () => {
    expect(typedDollar("<p>\n  $$\\sum_i i$$")).toBe(
      "<p>\n  <md>\\sum_i i</md>|",
    );
  });

  it("does nothing inside math", () => {
    expect(typedDollar("<p><m>a $b$")).toBeNull();
  });
});
