import { describe, expect, it } from "vitest";
import { detectDocumentKind } from "./document-kind";

describe("detectDocumentKind", () => {
  it("identifies a book by <book> root", () => {
    expect(detectDocumentKind("<pretext><book/></pretext>")).toBe("book");
  });

  it("identifies an article by <article>", () => {
    expect(detectDocumentKind("<pretext><article/></pretext>")).toBe("article");
  });

  it("falls back to book if <chapter> is present", () => {
    expect(detectDocumentKind("<chapter>x</chapter>")).toBe("book");
  });

  it("identifies a slideshow by <slideshow> root", () => {
    expect(detectDocumentKind("<pretext><slideshow/></pretext>")).toBe(
      "slideshow",
    );
  });

  it("prefers slideshow over a nested <section>", () => {
    // A slideshow's <section> only groups slides, so it must not be read as an
    // article the way a bare <section> would be.
    expect(
      detectDocumentKind(
        "<pretext><slideshow><section><slide/></section></slideshow></pretext>",
      ),
    ).toBe("slideshow");
  });

  it("falls back to slideshow if a bare <slide> is present", () => {
    expect(detectDocumentKind("<slide><title>x</title></slide>")).toBe(
      "slideshow",
    );
  });

  it("defaults to article for unknown structure", () => {
    expect(detectDocumentKind("<p>hello</p>")).toBe("article");
  });
});
