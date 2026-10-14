import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { fromXml } from "xast-util-from-xml";
import { countElements, ensureXmlId, selectDivision } from "./subtree.js";
import { tagIncludedFile } from "./xinclude.js";
import type { Element } from "xast";

// Line numbers matter here: every division is on its own line.
const BOOK = [
  `<pretext>`, // 1
  `  <docinfo><macros>x</macros></docinfo>`, // 2
  `  <book xml:id="bk">`, // 3
  `    <title>Book</title>`, // 4
  `    <chapter>`, // 5 (no xml:id)
  `      <title>C1</title>`, // 6
  `      <introduction><p>Intro.</p></introduction>`, // 7
  `      <section xml:id="s11">`, // 8
  `        <title>S11</title>`, // 9
  `        <subsection xml:id="ss111"><p>Deep.</p></subsection>`, // 10
  `      </section>`, // 11
  `    </chapter>`, // 12
  `    <chapter xml:id="c2"><title>C2</title><p>Two.</p></chapter>`, // 13
  `  </book>`, // 14
  `</pretext>`, // 15
].join("\n");

const FILE = path.resolve("/project/main.ptx");

function select(line: number, extra = {}) {
  return selectDivision(fromXml(BOOK), { line, ...extra }, FILE);
}

describe("selectDivision", () => {
  it("picks the innermost division around a line", () => {
    expect(select(10)?.element.name).toBe("subsection");
    expect(select(9)?.element.name).toBe("section");
    expect(select(7)?.element.name).toBe("chapter");
    expect(select(4)?.element.name).toBe("book");
  });

  it("falls back to the next division after a line outside any, then the last before", () => {
    // Line 2 is in docinfo: the book starts at line 3.
    expect(select(2)?.element.name).toBe("book");
    // Past the end: the nearest division before it, which is the last chapter.
    expect(select(99)?.id).toBe("c2");
  });

  it("selects by id, climbing from a non-division element to its division", () => {
    const tree = fromXml(BOOK);
    expect(selectDivision(tree, { id: "s11" }, FILE)?.id).toBe("s11");
    const macros = selectDivision(tree, { id: "c2" }, FILE);
    expect(macros?.element.name).toBe("chapter");
  });

  it("returns undefined when nothing matches", () => {
    expect(select(10, { file: "/elsewhere.ptx" })).toBeUndefined();
    expect(selectDivision(fromXml(BOOK), { id: "nope" }, FILE)).toBeUndefined();
    expect(selectDivision(fromXml(BOOK), {}, FILE)).toBeUndefined();
  });

  it("injects the id assembly would stamp when the division has none", () => {
    const chosen = select(7)!;
    // The book's authored id "bk" restarts the chain; the chapter is its
    // second element child (after the title).
    expect(chosen.id).toBe("bk-2");
    expect(chosen.element.attributes["xml:id"]).toBe("bk-2");
  });

  it("keeps an authored id", () => {
    expect(select(10)?.id).toBe("ss111");
  });

  describe("level", () => {
    it("climbs to the ancestor at the chunk level when the selection is deeper", () => {
      const chosen = select(10, { level: 1 })!;
      expect(chosen.element.name).toBe("chapter");
      expect(chosen.collapse).toBe(false);
    });

    it("keeps a selection at the chunk level whole", () => {
      const chosen = select(10, { level: 3 })!;
      expect(chosen.element.name).toBe("subsection");
      expect(chosen.collapse).toBe(false);
    });

    it("collapses a selection shallower than the chunk level", () => {
      const chosen = select(7, { level: 2 })!;
      expect(chosen.element.name).toBe("chapter");
      expect(chosen.collapse).toBe(true);
    });
  });

  it("matches lines in the file each element came from", () => {
    const main = fromXml(
      `<pretext>\n<book>\n<chapter xml:id="c1"><p>x</p></chapter>\n</book>\n</pretext>`,
    );
    const included = fromXml(
      `<chapter xml:id="inc">\n<section xml:id="inc-s"><p>y</p></section>\n</chapter>`,
    );
    const incRoot = included.children.find(
      (node): node is Element => node.type === "element",
    )!;
    const incFile = path.resolve("/project/inc.ptx");
    tagIncludedFile(incRoot, incFile);
    const book = (main.children[0] as Element).children.find(
      (node): node is Element => node.type === "element",
    )!;
    book.children.push(incRoot);
    // Line 2 of the included file is its section; line 2 of main is <book>.
    expect(selectDivision(main, { line: 2, file: incFile }, FILE)?.id).toBe(
      "inc-s",
    );
    expect(selectDivision(main, { line: 2 }, FILE)?.element.name).toBe("book");
  });
});

describe("ensureXmlId", () => {
  it("returns the authored id untouched", () => {
    const tree = fromXml(BOOK);
    const chosen = selectDivision(tree, { id: "c2" }, FILE)!;
    expect(ensureXmlId(tree, chosen.element)).toBe("c2");
  });
});

describe("countElements", () => {
  it("counts every element in the tree", () => {
    expect(countElements(fromXml(`<a><b/><c><d/></c></a>`))).toBe(4);
  });
});
