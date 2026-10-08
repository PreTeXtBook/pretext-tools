import { describe, expect, it } from "vitest";
import { scanXmlContext } from "./xml-context";

const at = (source: string, needle: string, occurrence = 0) => {
  let offset = -1;
  for (let i = 0; i <= occurrence; i++)
    offset = source.indexOf(needle, offset + 1);
  return scanXmlContext(source, offset);
};

const names = (source: string, needle: string) =>
  at(source, needle).open.map((element) => element.name);

describe("scanXmlContext", () => {
  it("reports the open elements, outermost first", () => {
    const source = "<section><p>Some <em>text</em> here</p></section>";
    expect(names(source, "text")).toEqual(["section", "p", "em"]);
    expect(names(source, "here")).toEqual(["section", "p"]);
    expect(at(source, "here").inText).toBe(true);
  });

  it("records where each start tag sits", () => {
    const source = '<p xml:id="a">x</p>';
    expect(at(source, "x<").open).toEqual([{ name: "p", start: 0, end: 14 }]);
  });

  it("is not in text inside a tag or attribute value", () => {
    expect(at('<p title="a > b">x</p>', "b").inText).toBe(false);
    expect(at('<p xml:id="x" >y</p>', ">").inText).toBe(false);
  });

  it("is not in text inside a comment, CDATA section or processing instruction", () => {
    expect(at("<!-- $x$ -->", "$").inText).toBe(false);
    expect(at("<![CDATA[ $x$ ]]>", "$").inText).toBe(false);
    expect(at('<?xml version="1.0"?>', "version").inText).toBe(false);
  });

  it("resumes after a closed comment", () => {
    expect(at("<p><!-- c -->text</p>", "text").inText).toBe(true);
  });

  it("does not count self-closing elements as open", () => {
    expect(names('<p>see <xref ref="a"/> here</p>', "here")).toEqual(["p"]);
  });

  it("reads a stray < as text", () => {
    expect(names("<p>if x < y then</p>", "then")).toEqual(["p"]);
  });

  it("ignores the character at the offset itself", () => {
    const source = "<p>a <";
    expect(scanXmlContext(source, source.length - 1).inText).toBe(true);
  });

  it("is inside a tag that the source ends before closing", () => {
    // Scanning only the text up to the cursor ends the source at the offset;
    // a tag still open there must not read as a closed one.
    const unclosed = (source: string) => scanXmlContext(source, source.length);
    expect(unclosed('<section xml:id="sec-').inText).toBe(false);
    expect(unclosed("<section ").inText).toBe(false);
    expect(unclosed("<p>a</p").inText).toBe(false);
    expect(unclosed("<section>").open.map((e) => e.name)).toEqual(["section"]);
    expect(unclosed("<section>").inText).toBe(true);
  });

  it("tolerates mismatched end tags", () => {
    expect(names("<section><p>a</em>b", "b")).toEqual(["section", "p"]);
  });
});
