import { describe, expect, it } from "vitest";
import { fromXml } from "xast-util-from-xml";
import { buildSkeleton, divisionLevel } from "./skeleton.js";
import type { Element } from "xast";

const BOOK = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <docinfo><macros>\\newcommand{\\Z}{\\mathbb{Z}}</macros></docinfo>
  <book xml:id="bk">
    <title>Book</title>
    <chapter xml:id="c1"><title>C1</title>
      <section xml:id="s11"><title>S11</title>
        <theorem xml:id="far"><title>Far</title><statement><p>Prose here.</p></statement></theorem>
      </section>
    </chapter>
    <chapter xml:id="c2"><title>C2</title>
      <section xml:id="s21"><title>S21</title><p>Filler prose.</p></section>
      <section xml:id="s22"><title>S22</title>
        <theorem xml:id="near"><title>Near</title><statement><p>Kept.</p></statement></theorem>
        <p>See <xref ref="far"/> and <xref ref="near"/>.</p>
      </section>
    </chapter>
  </book>
</pretext>`;

function skeletonOf(source: string, id: string) {
  const result = buildSkeleton(fromXml(source), id);
  if (!result) throw new Error(`no division ${id}`);
  return result;
}

describe("buildSkeleton", () => {
  it("keeps the previewed division verbatim", () => {
    const { content } = skeletonOf(BOOK, "s22");
    expect(content).toContain('<theorem xml:id="near">');
    expect(content).toContain("Kept.");
    expect(content).toContain('<xref ref="far">');
  });

  it("keeps every division so the table of contents stays complete", () => {
    const { content } = skeletonOf(BOOK, "s22");
    for (const id of ["bk", "c1", "s11", "c2", "s21", "s22"]) {
      expect(content).toContain(`xml:id="${id}"`);
    }
    expect(content).toContain("<title>S21</title>");
  });

  it("drops prose from divisions that are not being previewed", () => {
    const { content } = skeletonOf(BOOK, "s22");
    expect(content).not.toContain("Filler prose.");
  });

  it("keeps a cross-reference target's division, minus its text", () => {
    const { content } = skeletonOf(BOOK, "s22");
    // The target itself survives so PreTeXt can number it...
    expect(content).toContain('<theorem xml:id="far">');
    expect(content).toContain("<title>Far</title>");
    // ...but its prose does not.
    expect(content).not.toContain("Prose here.");
  });

  it("keeps docinfo verbatim, so the fragment's macros still expand", () => {
    const { content } = skeletonOf(BOOK, "s22");
    expect(content).toContain("\\newcommand{\\Z}{\\mathbb{Z}}");
  });

  it("reports the division's id and numbering level", () => {
    expect(skeletonOf(BOOK, "s22")).toMatchObject({
      divisionId: "s22",
      level: 2,
    });
    expect(skeletonOf(BOOK, "c2").level).toBe(1);
    expect(skeletonOf(BOOK, "bk").level).toBe(0);
  });

  it("returns undefined when the id names no division", () => {
    expect(buildSkeleton(fromXml(BOOK), "nope")).toBeUndefined();
  });

  it("shrinks the document substantially", () => {
    const { content } = skeletonOf(BOOK, "s22");
    expect(content.length).toBeLessThan(BOOK.length);
  });
});

describe("divisionLevel", () => {
  const el = (name: string): Element => ({
    type: "element",
    name,
    attributes: {},
    children: [],
  });

  it("puts the document element at level 0", () => {
    expect(divisionLevel([el("book")], false)).toBe(0);
    expect(divisionLevel([el("article")], false)).toBe(0);
  });

  it("counts one level per nested division", () => {
    expect(divisionLevel([el("book"), el("chapter")], false)).toBe(1);
    expect(
      divisionLevel([el("book"), el("chapter"), el("section")], false),
    ).toBe(2);
    expect(divisionLevel([el("article"), el("section")], false)).toBe(1);
  });

  it("pushes a book's chapters down one when parts are in play", () => {
    expect(divisionLevel([el("book"), el("part"), el("chapter")], true)).toBe(
      2,
    );
  });

  it("treats front matter as level 0 in an article", () => {
    expect(divisionLevel([el("article"), el("frontmatter")], false)).toBe(0);
    // A preface is then a peer of a section.
    expect(
      divisionLevel([el("article"), el("frontmatter"), el("preface")], false),
    ).toBe(1);
  });

  it("treats a book's front matter as a peer of its chapters", () => {
    expect(
      divisionLevel([el("book"), el("frontmatter"), el("preface")], false),
    ).toBe(1);
    expect(
      divisionLevel([el("book"), el("frontmatter"), el("preface")], true),
    ).toBe(2);
  });
});
