import { describe, expect, it } from "vitest";
import { findFirstElement, findTopLevelElements } from "./xml-scan";

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
