import { describe, it, expect } from "vitest";
import {
  firstDivisionTag,
  isInlineContext,
  placeConvertedMarkup,
  reindentForContext,
} from "./place-markup";

describe("isInlineContext", () => {
  it("is true inside an open paragraph", () => {
    expect(isInlineContext("<section><p>Some text ")).toBe(true);
  });

  it("is false once the paragraph closes", () => {
    expect(isInlineContext("<section><p>Some text</p>\n  ")).toBe(false);
  });

  it("is false at the top of a division", () => {
    expect(isInlineContext("<section><title>One</title>\n  ")).toBe(false);
  });

  it("does not mistake other tags that start with p", () => {
    expect(isInlineContext("<section><paragraphs><title>X</title>")).toBe(
      false,
    );
    expect(isInlineContext("<pre>code</pre>")).toBe(false);
  });

  it("handles nested paragraphs closing back out", () => {
    expect(isInlineContext("<p>a</p><p>b</p><p>c")).toBe(true);
  });
});

describe("firstDivisionTag", () => {
  it("finds a division element", () => {
    expect(
      firstDivisionTag('<section xml:id="x"><title>A</title></section>'),
    ).toBe("section");
  });

  it("ignores non-division markup", () => {
    expect(firstDivisionTag("<p>Text <em>here</em></p>")).toBeUndefined();
  });

  it("does not match a tag that merely starts the same way", () => {
    expect(firstDivisionTag("<sectional>")).toBeUndefined();
  });
});

describe("placeConvertedMarkup", () => {
  const block = { inline: false, baseIndent: "", midLine: false };

  it("leaves block context untouched", () => {
    const { markup, warning } = placeConvertedMarkup("<p>Hello.</p>", block);
    expect(markup).toBe("<p>Hello.</p>");
    expect(warning).toBeUndefined();
  });

  it("unwraps the converter's <p> when pasting inside a paragraph", () => {
    const { markup } = placeConvertedMarkup("<p>Hello <em>there</em>.</p>", {
      inline: true,
      baseIndent: "",
      midLine: true,
    });
    expect(markup).toBe("Hello <em>there</em>.");
  });

  it("warns when a division lands inside a paragraph, but still inserts it", () => {
    const { markup, warning } = placeConvertedMarkup(
      "<section><title>One</title></section>",
      { inline: true, baseIndent: "", midLine: true },
    );
    expect(markup).toContain("<section>");
    expect(warning).toMatch(/<section>.*cannot sit inside a <p>/);
  });

  it("indents every line to the insertion point", () => {
    const { markup } = placeConvertedMarkup("<p>One</p>\n<p>Two</p>", {
      inline: false,
      baseIndent: "    ",
      midLine: false,
    });
    expect(markup).toBe("    <p>One</p>\n    <p>Two</p>");
  });

  it("leaves the first line alone when the paste starts mid-line", () => {
    const { markup } = placeConvertedMarkup("<p>One</p>\n<p>Two</p>", {
      inline: false,
      baseIndent: "  ",
      midLine: true,
    });
    expect(markup).toBe("<p>One</p>\n  <p>Two</p>");
  });
});

describe("reindentForContext", () => {
  it("does not indent blank lines", () => {
    expect(reindentForContext("a\n\nb", "  ", false)).toBe("  a\n\n  b");
  });
});
