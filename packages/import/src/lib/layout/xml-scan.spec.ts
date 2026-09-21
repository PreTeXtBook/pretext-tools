import { describe, expect, it } from "vitest";
import {
  findFirstElement,
  findRootElement,
  findTopLevelElements,
} from "./xml-scan";

describe("findTopLevelElements", () => {
  it("returns only top-level <name> elements (nested ones do not count)", () => {
    const src = "<a/><b><a/></b><a><i>x</i></a>";
    const a = findTopLevelElements(src, "a");
    expect(a).toHaveLength(2);
    expect(a[0].outer).toBe("<a/>");
    expect(a[1].inner).toBe("<i>x</i>");
  });

  it("captures attributes from the opening tag", () => {
    const src = '<chapter xml:id="intro" class="x">hi</chapter>';
    const [el] = findTopLevelElements(src, "chapter");
    expect(el.attributes["xml:id"]).toBe("intro");
    expect(el.attributes["class"]).toBe("x");
  });

  it("handles self-closing elements (including namespaced names)", () => {
    const [el] = findTopLevelElements(
      '<xi:include href="ch.ptx"/>',
      "xi:include",
    );
    expect(el).toBeDefined();
    expect(el.attributes["href"]).toBe("ch.ptx");
    expect(el.inner).toBe("");
  });

  it("finds nested chapters only at top level (no parts)", () => {
    const src =
      "<book><chapter>1</chapter><part><chapter>2</chapter></part><chapter>3</chapter></book>";
    // search inside book.inner for top-level chapters
    const book = findFirstElement(src, "book");
    expect(book).toBeTruthy();
    const chapters = findTopLevelElements(book!.inner, "chapter");
    expect(chapters).toHaveLength(2); // chapters under <part> are not direct children
    expect(chapters[0].inner).toBe("1");
    expect(chapters[1].inner).toBe("3");
  });

  it("skips comments", () => {
    const src = "<!-- <chapter>nope</chapter> --><chapter>yes</chapter>";
    const ch = findTopLevelElements(src, "chapter");
    expect(ch).toHaveLength(1);
    expect(ch[0].inner).toBe("yes");
  });
});

describe("findRootElement", () => {
  // `source` here is the content of <pretext>, which is what every caller
  // passes: <docinfo> sits alongside the root rather than inside it.
  it("returns the root element, whichever of the three it is", () => {
    for (const tag of ["book", "article", "slideshow"]) {
      const root = findRootElement(
        `<docinfo/><${tag}><title>T</title></${tag}>`,
      );
      expect(root?.name).toBe(tag);
    }
  });

  it("returns null for a bare fragment with no root", () => {
    expect(findRootElement("<section><p>x</p></section>")).toBeNull();
  });

  it("rejects a root element nested inside the root", () => {
    // pretext.rng references every root only from PretextRoot, so no content
    // model admits one -- this is unreadable as a document, not just unusual.
    expect(() =>
      findRootElement(
        "<article><section><slideshow><slide/></slideshow></section></article>",
      ),
    ).toThrow(/<slideshow> is a PreTeXt root element/);
  });

  it("names the offending pair so the author can find it", () => {
    expect(() =>
      findRootElement("<book><chapter><article/></chapter></book>"),
    ).toThrow(/cannot appear inside the document's <book> root/);
  });

  it("rejects two root elements side by side, whatever their order", () => {
    expect(() =>
      findRootElement('<article xml:id="a"/><slideshow xml:id="s"/>'),
    ).toThrow(/has 2 side by side: <article>, <slideshow>/);
    expect(() =>
      findRootElement('<slideshow xml:id="s"/><article xml:id="a"/>'),
    ).toThrow(/has 2 side by side: <slideshow>, <article>/);
  });

  it("does not mistake a root element named in a comment or CDATA", () => {
    // A PreTeXt document about PreTeXt may quote <slideshow> in a listing.
    expect(
      findRootElement("<article><!-- <slideshow/> --><p>x</p></article>")?.name,
    ).toBe("article");
    expect(
      findRootElement("<article><pre><![CDATA[<slideshow/>]]></pre></article>")
        ?.name,
    ).toBe("article");
  });
});
