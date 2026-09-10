import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  PARAGRAPH_CONTENT_EXCLUSIONS,
  firstDivisionTag,
  isInlineContext,
  placeConvertedMarkup,
  reindentForContext,
  wrapLooseParagraphs,
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

describe("wrapLooseParagraphs", () => {
  it("wraps a bare paragraph of text", () => {
    expect(wrapLooseParagraphs("Let <m>G</m> be a group.")).toBe(
      "<p>Let <m>G</m> be a group.</p>",
    );
  });

  it("leaves markup the converter already wrapped alone", () => {
    const markup = "<p>One</p>\n<p>Two</p>";
    expect(wrapLooseParagraphs(markup)).toBe(markup);
  });

  it("wraps the text on either side of a block element", () => {
    expect(
      wrapLooseParagraphs(
        "Intro <theorem><statement><p>Body.</p></statement></theorem> outro.",
      ),
    ).toBe(
      "<p>Intro</p> <theorem><statement><p>Body.</p></statement></theorem> <p>outro.</p>",
    );
  });

  it("keeps paragraph-level content in the paragraph it belongs to", () => {
    // <md> and <ol> are TextParagraphItems: they live inside a <p>, so they
    // must not split the run of text they are part of.
    expect(wrapLooseParagraphs("Look at <md>x^{2}</md> the display.")).toBe(
      "<p>Look at <md>x^{2}</md> the display.</p>",
    );
    expect(
      wrapLooseParagraphs("A list: <ol><li><p>A</p></li></ol> and more."),
    ).toBe("<p>A list: <ol><li><p>A</p></li></ol> and more.</p>");
  });

  it("gives a lone paragraph-level element the <p> it needs", () => {
    expect(wrapLooseParagraphs("<md>x^{2}</md>")).toBe("<p><md>x^{2}</md></p>");
    expect(wrapLooseParagraphs("<em>group</em>")).toBe("<p><em>group</em></p>");
  });

  it("leaves a lone block element alone", () => {
    expect(wrapLooseParagraphs('<image source="foo.png" />')).toBe(
      '<image source="foo.png" />',
    );
    expect(wrapLooseParagraphs("<pre>\ncode\n</pre>")).toBe(
      "<pre>\ncode\n</pre>",
    );
    expect(wrapLooseParagraphs("<sage>2+2</sage>")).toBe("<sage>2+2</sage>");
  });

  it("mixes wrapped and unwrapped siblings", () => {
    expect(
      wrapLooseParagraphs("<p>Some intro.</p><pre>\ncode\n</pre>After."),
    ).toBe("<p>Some intro.</p><pre>\ncode\n</pre><p>After.</p>");
  });

  it("keeps whitespace and comments outside the paragraph", () => {
    expect(wrapLooseParagraphs("\n  Hello.\n")).toBe("\n  <p>Hello.</p>\n");
    expect(wrapLooseParagraphs("<!-- a comment-->Just text.")).toBe(
      "<!-- a comment--><p>Just text.</p>",
    );
  });

  it("does not manufacture a paragraph out of nothing", () => {
    expect(wrapLooseParagraphs("")).toBe("");
    expect(wrapLooseParagraphs("<p>A</p>\n<!-- note -->\n<p>B</p>")).toBe(
      "<p>A</p>\n<!-- note -->\n<p>B</p>",
    );
  });

  it("is idempotent", () => {
    const once = wrapLooseParagraphs("Intro <pre>x</pre> outro.");
    expect(wrapLooseParagraphs(once)).toBe(once);
  });
});

describe("placeConvertedMarkup", () => {
  const block = { inline: false, baseIndent: "", midLine: false };

  it("leaves block context untouched", () => {
    const { markup, warning } = placeConvertedMarkup("<p>Hello.</p>", block);
    expect(markup).toBe("<p>Hello.</p>");
    expect(warning).toBeUndefined();
  });

  it("wraps a converter's unwrapped paragraph in block context", () => {
    const { markup, warning } = placeConvertedMarkup(
      "Let <m>G</m> be a <em>group</em>.",
      block,
    );
    expect(markup).toBe("<p>Let <m>G</m> be a <em>group</em>.</p>");
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

  it("does not add a <p> when pasting inside a paragraph", () => {
    const { markup, warning } = placeConvertedMarkup("Hello <em>there</em>.", {
      inline: true,
      baseIndent: "",
      midLine: true,
    });
    expect(markup).toBe("Hello <em>there</em>.");
    expect(warning).toBeUndefined();
  });

  it("warns instead of mangling several paragraphs pasted inside one", () => {
    const { markup, warning } = placeConvertedMarkup("<p>One</p><p>Two</p>", {
      inline: true,
      baseIndent: "",
      midLine: true,
    });
    expect(markup).toBe("<p>One</p><p>Two</p>");
    expect(warning).toMatch(/more than one paragraph/);
  });

  it("does not mistake a nested paragraph for a second one", () => {
    // <ol> is legal inside a <p>; the <p> inside its <li> is not a top-level
    // paragraph and must not read as one.
    const { markup, warning } = placeConvertedMarkup(
      "A list: <ol><li><p>A</p></li></ol> and more.",
      { inline: true, baseIndent: "", midLine: true },
    );
    expect(markup).toBe("A list: <ol><li><p>A</p></li></ol> and more.");
    expect(warning).toBeUndefined();
  });

  it("warns about any block element inside a paragraph, not only divisions", () => {
    const { warning } = placeConvertedMarkup(
      "Intro <theorem><statement><p>Body.</p></statement></theorem> outro.",
      { inline: true, baseIndent: "", midLine: true },
    );
    expect(warning).toMatch(/<theorem>.*cannot sit inside a <p>/);
    expect(warning).not.toMatch(/more than one paragraph/);
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

// Guards the hand-copied `PARAGRAPH_CONTENT_TAGS` against the generated schema
// it was taken from. A schema refresh that adds an element to the `<p>` content
// model must add it here too, or that element gets treated as block content and
// splits the paragraph it belongs to.
describe("PARAGRAPH_CONTENT_TAGS", () => {
  const __dirname = fileURLToPath(new URL(".", import.meta.url));

  /** Both files are committed with CRLF on Windows checkouts. */
  const readNormalized = (...segments: string[]): string =>
    readFileSync(join(...segments), "utf8").replace(/\r\n/g, "\n");

  function schemaParagraphChildren(): string[] {
    const source = readNormalized(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "completions",
      "src",
      "default-dev-schema.ts",
    );
    const entry = /\n {2}"p": (\{[\s\S]*?\n {2}\}),\n/.exec(source);
    if (!entry) {
      throw new Error("could not find the <p> entry in default-dev-schema.ts");
    }
    return (JSON.parse(entry[1]) as { elements: string[] }).elements;
  }

  function fileParagraphChildren(): string[] {
    const source = readNormalized(__dirname, "place-markup.ts");
    const literal = /PARAGRAPH_CONTENT_TAGS[^`]*`([^`]*)`/.exec(source);
    if (!literal) {
      throw new Error(
        "could not find PARAGRAPH_CONTENT_TAGS in place-markup.ts",
      );
    }
    return literal[1].trim().split(/\s+/);
  }

  it("matches the generated <p> content model, minus the documented exclusions", () => {
    const expected = schemaParagraphChildren()
      .filter((tag) => !PARAGRAPH_CONTENT_EXCLUSIONS.includes(tag))
      .sort();
    expect(fileParagraphChildren().sort()).toEqual(expected);
  });

  it("excludes only tags the schema actually lists", () => {
    const schema = schemaParagraphChildren();
    for (const tag of PARAGRAPH_CONTENT_EXCLUSIONS) {
      expect(schema).toContain(tag);
    }
  });
});
