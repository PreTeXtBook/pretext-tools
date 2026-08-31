import { describe, expect, it } from "vitest";
import {
  containerChainAt,
  hrefBaseFor,
  offeredTargetTags,
  readExternalDirectory,
  resolveAttachmentPoint,
  xiNamespaceInsertion,
} from "./insert-import-core";
import { parseOutline } from "./outline-parser";

/** Resolve at the position marked `|` in `text` (the marker is removed). */
function attachAt(marked: string) {
  const offset = marked.indexOf("|");
  const text = marked.replace("|", "");
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  const character = offset - (before.lastIndexOf("\n") + 1);
  return resolveAttachmentPoint(text, line, character, offset);
}

const BOOK = `<pretext>
  <book xml:id="bk">
    <title>Book</title>
    <chapter xml:id="ch1">
      <title>One</title>
      <section xml:id="s1">
        <title>S1</title>
        <p>Some prose here.</p>
      </section>
      |
    </chapter>
  </book>
</pretext>`;

describe("resolveAttachmentPoint: the level", () => {
  it("attaches a child of the division holding the cursor", () => {
    const point = attachAt(BOOK);
    expect(point?.containerTag).toBe("chapter");
    expect(point?.targetTag).toBe("section");
  });

  it("goes one level deeper inside a section", () => {
    const point = attachAt(
      `<article xml:id="a"><title>A</title>
  <section xml:id="s"><title>S</title>
    |
  </section>
</article>`,
    );
    expect(point?.targetTag).toBe("subsection");
  });

  it("uses chapters at the top level of a book", () => {
    const point = attachAt(
      `<pretext><book xml:id="b"><title>B</title>
  |
</book></pretext>`,
    );
    expect(point?.targetTag).toBe("chapter");
  });

  it("uses sections at the top level of an article", () => {
    const point = attachAt(
      `<pretext><article xml:id="a"><title>A</title>
  |
</article></pretext>`,
    );
    expect(point?.targetTag).toBe("section");
  });

  it("reads an appendix as a chapter in a book and a section in an article", () => {
    const inBook = attachAt(
      `<pretext><book xml:id="b"><title>B</title><backmatter>
  <appendix xml:id="app"><title>App</title>
    |
  </appendix>
</backmatter></book></pretext>`,
    );
    expect(inBook?.targetTag).toBe("section");

    const inArticle = attachAt(
      `<pretext><article xml:id="a"><title>A</title><backmatter>
  <appendix xml:id="app"><title>App</title>
    |
  </appendix>
</backmatter></article></pretext>`,
    );
    expect(inArticle?.targetTag).toBe("subsection");
  });

  it("has nothing to attach to outside any division", () => {
    expect(attachAt(`<pretext>\n  |\n</pretext>`)).toBeUndefined();
  });
});

describe("resolveAttachmentPoint: the position", () => {
  it("places the include on the cursor's own line", () => {
    const point = attachAt(BOOK);
    // The blank line after </section>.
    expect(point?.line).toBe(9);
    expect(point?.note).toBeUndefined();
  });

  it("indents the include to match its surroundings", () => {
    const point = attachAt(BOOK);
    expect(point?.indent).toBe("      ");
  });

  it("moves out of a paragraph, where an include cannot go", () => {
    const point = attachAt(
      `<article xml:id="a"><title>A</title>
  <section xml:id="s"><title>S</title>
    <p>Some prose |here.</p>
  </section>
</article>`,
    );
    expect(point?.targetTag).toBe("subsection");
    // The line of </section>, i.e. the end of the containing division.
    expect(point?.line).toBe(3);
    expect(point?.note).toContain("paragraph");
  });

  it("lands beside a subsubsection rather than inside it", () => {
    const point = attachAt(
      `<article xml:id="a"><title>A</title>
  <section xml:id="s"><title>S</title>
    <subsection xml:id="ss"><title>SS</title>
      <subsubsection xml:id="sss"><title>SSS</title>
        |
      </subsubsection>
    </subsection>
  </section>
</article>`,
    );
    expect(point?.targetTag).toBe("subsubsection");
    expect(point?.containerTag).toBe("subsection");
    expect(point?.line).toBe(6); // after </subsubsection>
    expect(point?.note).toContain("takes no divisions");
  });

  it("treats a worksheet as holding no divisions", () => {
    const point = attachAt(
      `<article xml:id="a"><title>A</title>
  <section xml:id="s"><title>S</title>
    <worksheet xml:id="w"><title>W</title>
      |
    </worksheet>
  </section>
</article>`,
    );
    expect(point?.containerTag).toBe("section");
    expect(point?.targetTag).toBe("subsection");
    expect(point?.note).toContain("worksheet");
  });
});

describe("containerChainAt", () => {
  it("does not claim a division the cursor has already left", () => {
    const text = `<article xml:id="a"><title>A</title>
  <section xml:id="s1"><title>One</title></section>
  <section xml:id="s2"><title>Two</title></section>
</article>`;
    const chain = containerChainAt(parseOutline(text), 2, 4);
    expect(chain.map((item) => item.xmlId)).toEqual(["a", "s2"]);
  });

  it("returns the chain outermost first", () => {
    const text = `<book xml:id="b"><title>B</title>
  <chapter xml:id="c"><title>C</title>
    <section xml:id="s"><title>S</title>
    </section>
  </chapter>
</book>`;
    const chain = containerChainAt(parseOutline(text), 3, 4);
    expect(chain.map((item) => item.tag)).toEqual([
      "book",
      "chapter",
      "section",
    ]);
  });
});

describe("hrefBaseFor", () => {
  it("gives the directory the including file lives in", () => {
    expect(hrefBaseFor("source/ch-intro.ptx")).toBe("source/");
    expect(hrefBaseFor("source/ch-intro/sec-1.ptx")).toBe("source/ch-intro/");
    expect(hrefBaseFor("main.ptx")).toBe("");
  });
});

describe("xiNamespaceInsertion", () => {
  it("declares the namespace on a file that has none", () => {
    const text = `<?xml version="1.0"?>\n<chapter xml:id="ch">\n</chapter>`;
    const insertion = xiNamespaceInsertion(text);
    expect(insertion).toBeDefined();
    const patched =
      text.slice(0, insertion!.offset) +
      insertion!.attribute +
      text.slice(insertion!.offset);
    expect(patched).toContain(
      '<chapter xmlns:xi="http://www.w3.org/2001/XInclude" xml:id="ch">',
    );
  });

  it("leaves a file that already declares it alone", () => {
    expect(
      xiNamespaceInsertion(
        `<pretext xmlns:xi="http://www.w3.org/2001/XInclude"></pretext>`,
      ),
    ).toBeUndefined();
  });

  it("is not fooled by a comment before the root", () => {
    const text = `<!-- <section> is not the root -->\n<article xml:id="a"></article>`;
    const insertion = xiNamespaceInsertion(text);
    expect(text.slice(insertion!.offset - 8, insertion!.offset)).toBe(
      "<article",
    );
  });
});

describe("offeredTargetTags", () => {
  it("offers the cursor's level and everything deeper", () => {
    expect(offeredTargetTags("section")).toEqual([
      "section",
      "subsection",
      "subsubsection",
    ]);
  });

  it("never offers a level shallower than the container allows", () => {
    // Escaping the division it is attached to is not a choice worth offering.
    expect(offeredTargetTags("subsubsection")).toEqual(["subsubsection"]);
  });

  it("leaves a role-named division standing alone", () => {
    expect(offeredTargetTags("appendix")).toEqual(["appendix"]);
  });
});

describe("readExternalDirectory", () => {
  it("reads the directory a publication file declares", () => {
    expect(
      readExternalDirectory(
        `<publication><source><directories external="../assets" generated="../gen"/></source></publication>`,
      ),
    ).toBe("../assets");
  });

  it("drops a trailing slash, since the import package wants a bare name", () => {
    expect(
      readExternalDirectory(`<directories external="images/" generated="g"/>`),
    ).toBe("images");
  });

  it("treats an absolute path as unset, as PreTeXt does", () => {
    expect(
      readExternalDirectory(`<directories external="/abs" generated="g"/>`),
    ).toBeUndefined();
  });

  it("returns nothing when the publication file declares no directories", () => {
    expect(
      readExternalDirectory(`<publication><common/></publication>`),
    ).toBeUndefined();
  });
});
