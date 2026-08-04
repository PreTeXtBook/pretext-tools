import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getXincludeLinks } from "./get-xinclude-links";

const URI = "file:///book/source/main.ptx";

function doc(text: string, uri = URI) {
  return TextDocument.create(uri, "pretext", 1, text);
}

function linksFor(text: string, uri = URI) {
  return getXincludeLinks(doc(text, uri));
}

/** The text each link's range covers, for readability in assertions. */
function linkedText(text: string, uri = URI) {
  const document = doc(text, uri);
  return getXincludeLinks(document).map((link) => document.getText(link.range));
}

describe("getXincludeLinks", () => {
  it("resolves hrefs relative to the containing document", () => {
    const links = linksFor(
      `<pretext>\n  <book>\n    <xi:include href="ch1.ptx"/>\n    <xi:include href="../shared/bib.ptx"/>\n  </book>\n</pretext>`,
    );
    expect(links.map((l) => l.target)).toEqual([
      "file:///book/source/ch1.ptx",
      "file:///book/shared/bib.ptx",
    ]);
  });

  it("covers the href value only, not the quotes", () => {
    expect(
      linkedText(`<pretext>\n  <xi:include href="ch1.ptx"/>\n</pretext>`),
    ).toEqual(["ch1.ptx"]);
  });

  it("handles single quotes, extra attributes, and odd spacing", () => {
    expect(
      linkedText(
        `<pretext>\n  <xi:include   parse='xml'   href = 'sec/intro.ptx'  />\n</pretext>`,
      ),
    ).toEqual(["sec/intro.ptx"]);
  });

  it("finds includes spread across several lines", () => {
    const text = `<pretext>\n  <book>\n    <xi:include\n      href="ch1.ptx"\n    />\n  </book>\n</pretext>`;
    expect(linkedText(text)).toEqual(["ch1.ptx"]);
    expect(linksFor(text)[0].range.start.line).toBe(3);
  });

  it("works on a document a strict parser would reject", () => {
    // Unclosed <title>, and the xi: prefix is never declared: no AST possible,
    // but the author still expects the include to be clickable.
    const text = `<pretext>\n  <book>\n    <title>Broken\n    <xi:include href="ch1.ptx"/>\n  </book>\n</pretext>`;
    expect(linksFor(text).map((l) => l.target)).toEqual([
      "file:///book/source/ch1.ptx",
    ]);
  });

  it("finds an include before the document is finished being typed", () => {
    expect(
      linksFor(`<pretext>\n  <xi:include href="ch1.ptx"`).map((l) => l.target),
    ).toEqual(["file:///book/source/ch1.ptx"]);
  });

  it("ignores includes inside comments and CDATA", () => {
    expect(
      linksFor(
        `<pretext>\n  <!-- <xi:include href="old.ptx"/> -->\n  <p><![CDATA[<xi:include href="literal.ptx"/>]]></p>\n  <xi:include href="ch1.ptx"/>\n</pretext>`,
      ).map((l) => l.target),
    ).toEqual(["file:///book/source/ch1.ptx"]);
  });

  it("keeps ranges correct after a multi-line comment", () => {
    const text = `<pretext>\n  <!-- a\n  multi-line\n  comment -->\n  <xi:include href="ch1.ptx"/>\n</pretext>`;
    const links = linksFor(text);
    expect(linkedText(text)).toEqual(["ch1.ptx"]);
    expect(links[0].range.start.line).toBe(4);
  });

  it("ignores elements that are not includes", () => {
    expect(
      linksFor(
        `<pretext>\n  <book>\n    <image source="fig.png"/>\n    <xref ref="sec-one"/>\n    <myinclude href="no.ptx"/>\n  </book>\n</pretext>`,
      ),
    ).toEqual([]);
  });

  it("skips includes with no href, and empty hrefs", () => {
    expect(
      linksFor(
        `<pretext>\n  <xi:include xpointer="ch1"/>\n  <xi:include href="  "/>\n</pretext>`,
      ),
    ).toEqual([]);
  });

  it("decodes entities in the href when building the target", () => {
    const text = `<pretext>\n  <xi:include href="a&amp;b.ptx"/>\n</pretext>`;
    expect(linksFor(text)[0].target).toBe("file:///book/source/a&b.ptx");
    // The range still covers the raw, encoded source text.
    expect(linkedText(text)).toEqual(["a&amp;b.ptx"]);
  });
});
