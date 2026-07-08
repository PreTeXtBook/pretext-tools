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
