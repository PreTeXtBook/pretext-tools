import { describe, it, expect } from "vitest";
import { parseOutline, extractTitle, cleanText } from "./outline-parser";

describe("parseOutline", () => {
  it("builds a nested tree of chapters and sections", () => {
    const src = [
      "<book>",
      '  <chapter xml:id="ch-one">',
      "    <title>First Chapter</title>",
      '    <section xml:id="sec-a">',
      "      <title>Section A</title>",
      "    </section>",
      "  </chapter>",
      "</book>",
    ].join("\n");

    const [book] = parseOutline(src);
    expect(book.tag).toBe("book");
    expect(book.children).toHaveLength(1);

    const chapter = book.children[0];
    expect(chapter.tag).toBe("chapter");
    expect(chapter.title).toBe("First Chapter");
    expect(chapter.xmlId).toBe("ch-one");
    expect(chapter.line).toBe(1);

    const section = chapter.children[0];
    expect(section.tag).toBe("section");
    expect(section.title).toBe("Section A");
    expect(section.xmlId).toBe("sec-a");
  });

  it("closes sections at the right depth so siblings are not nested", () => {
    const src = [
      "<chapter>",
      "  <section><title>One</title></section>",
      "  <section><title>Two</title></section>",
      "</chapter>",
    ].join("\n");

    const [chapter] = parseOutline(src);
    expect(chapter.children.map((c) => c.title)).toEqual(["One", "Two"]);
  });

  it("ignores outline tags that appear inside XML comments", () => {
    const src = [
      "<chapter>",
      "  <!-- <section><title>Ghost</title></section> -->",
      "  <section><title>Real</title></section>",
      "</chapter>",
    ].join("\n");

    const [chapter] = parseOutline(src);
    expect(chapter.children.map((c) => c.title)).toEqual(["Real"]);
  });

  it("records the column where the opening tag starts", () => {
    const [section] = parseOutline(
      "    <section><title>Indented</title></section>",
    );
    expect(section.character).toBe(4);
  });

  it("does not let an untitled division steal a following division's title", () => {
    const src = [
      "<chapter>",
      '  <section xml:id="s">',
      "    <title>Real Section</title>",
      "  </section>",
      "</chapter>",
    ].join("\n");

    const [chapter] = parseOutline(src);
    expect(chapter.title).toBe("");
    expect(chapter.children.map((c) => c.title)).toEqual(["Real Section"]);
  });

  it("recognizes parts and nests chapters inside them", () => {
    const src = [
      "<book>",
      "  <part>",
      "    <title>Part One</title>",
      "    <chapter><title>Ch A</title></chapter>",
      "  </part>",
      "</book>",
    ].join("\n");

    const [book] = parseOutline(src);
    const part = book.children[0];
    expect(part.tag).toBe("part");
    expect(part.title).toBe("Part One");
    expect(part.children.map((c) => c.title)).toEqual(["Ch A"]);
  });

  it("finds a tag on a line that also opens a comment", () => {
    const src = [
      "<chapter>",
      '  <section xml:id="x"> <!-- TODO: write this -->',
      "    <title>Kept</title>",
      "  </section>",
      "</chapter>",
    ].join("\n");

    const [chapter] = parseOutline(src);
    expect(chapter.children).toHaveLength(1);
    expect(chapter.children[0].xmlId).toBe("x");
    expect(chapter.children[0].title).toBe("Kept");
  });

  it("still ignores tags inside a multi-line comment", () => {
    const src = [
      "<chapter>",
      "  <!--",
      "    <section><title>Ghost</title></section>",
      "  -->",
      "  <section><title>Real</title></section>",
      "</chapter>",
    ].join("\n");

    const [chapter] = parseOutline(src);
    expect(chapter.children.map((c) => c.title)).toEqual(["Real"]);
  });

  it("processes two closing tags on one line in textual order", () => {
    const src = [
      "<book>",
      "  <chapter>",
      "    <section><title>One</title>",
      "  </section></chapter>",
      "  <chapter><title>Two</title></chapter>",
      "</book>",
    ].join("\n");

    const [book] = parseOutline(src);
    // Both chapters are siblings under the book (the section did not swallow
    // the second chapter, and the book stayed on the stack).
    expect(book.children.map((c) => c.tag)).toEqual(["chapter", "chapter"]);
    expect(book.children[1].title).toBe("Two");
  });

  it("sees both opening tags when two appear on one line", () => {
    const src = ["<chapter><section><title>Inline</title></section>"].join("\n");
    const [chapter] = parseOutline(src);
    expect(chapter.tag).toBe("chapter");
    expect(chapter.children.map((c) => c.tag)).toEqual(["section"]);
  });

  it("survives a stray closing tag with nothing open", () => {
    const src = [
      "</chapter>",
      "<chapter><title>After</title></chapter>",
    ].join("\n");

    const roots = parseOutline(src);
    expect(roots.map((r) => r.title)).toEqual(["After"]);
  });
});

describe("extractTitle", () => {
  it("reads a multi-line title within the look-ahead window", () => {
    const lines = ["<section>", "  <title>", "    Spread Out", "  </title>"];
    expect(extractTitle(lines, 0)).toBe("Spread Out");
  });

  it("returns an empty string when there is no title nearby", () => {
    expect(extractTitle(["<section>", "  <p>text</p>"], 0)).toBe("");
  });
});

describe("cleanText", () => {
  it("strips inline tags and collapses whitespace", () => {
    expect(cleanText("A  <em>bold</em>\n  claim")).toBe("A bold claim");
  });
});
