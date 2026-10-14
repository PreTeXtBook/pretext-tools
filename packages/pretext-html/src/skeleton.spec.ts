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

  it("keeps a shell of every division the table of contents lists", () => {
    // A book with sections lists chapters and sections (level 2) by default.
    const { content } = skeletonOf(BOOK, "s22");
    for (const id of ["bk", "c1", "s11", "c2", "s21", "s22"]) {
      expect(content).toContain(`xml:id="${id}"`);
    }
    expect(content).toContain("<title>S21</title>");
  });

  // Subsections below the contents depth, in chapters the preview has no
  // business with. Only the previewed chain's siblings keep theirs.
  const DEEP_BOOK = BOOK.replace(
    `<section xml:id="s21"><title>S21</title><p>Filler prose.</p></section>`,
    `<section xml:id="s21"><title>S21</title><p>Filler prose.</p>
        <subsection xml:id="ss211"><title>SS211</title><p>Elsewhere.</p></subsection></section>`,
  )
    .replace(
      `<p>See <xref ref="far"/> and <xref ref="near"/>.</p>`,
      `<subsection xml:id="ss221"><title>SS221</title><theorem xml:id="before"><statement><p>Counted.</p></statement></theorem></subsection>
        <subsection xml:id="ss222"><title>SS222</title><p>See <xref ref="far"/> and <xref ref="near"/>.</p></subsection>
        <subsection xml:id="ss223"><title>SS223</title><p>After.</p></subsection>`,
    )
    .replace(
      `  </book>`,
      `    <chapter xml:id="c3"><title>C3</title>
      <section xml:id="s31"><title>S31</title><p>Third.</p></section>
    </chapter>
  </book>`,
    );

  it("drops divisions below the contents depth that nothing needs", () => {
    const { content } = skeletonOf(DEEP_BOOK, "ss222");
    expect(content).not.toContain('xml:id="ss211"');
    expect(content).toContain('xml:id="s21"');
  });

  it("keeps a shell of every sibling along the previewed division's ancestry", () => {
    const { content } = skeletonOf(DEEP_BOOK, "ss222");
    expect(content).toContain('xml:id="ss223"');
    expect(content).not.toContain("After.");
  });

  it("keeps the blocks of preceding siblings within the numbering scope, without their text", () => {
    // Blocks number within sections in a book, so the theorem in ss221 is
    // Theorem 2.2.1 and the one in ss222 must come out as 2.2.2.
    const { content } = skeletonOf(DEEP_BOOK, "ss222");
    expect(content).toContain('<theorem xml:id="before">');
    expect(content).not.toContain("Counted.");
  });

  it("lets the contents depth be lowered, keeping less", () => {
    // By default (contents to level 2) chapter 3's section is listed.
    expect(skeletonOf(DEEP_BOOK, "ss222").content).toContain('xml:id="s31"');
    const result = buildSkeleton(fromXml(DEEP_BOOK), "ss222", {
      tocLevel: 0,
    });
    // Chapter 3 is still counted — a shell, being a sibling on the chain —
    // but nothing lists or numbers against its section, so it goes.
    expect(result?.content).toContain('xml:id="c3"');
    expect(result?.content).not.toContain('xml:id="s31"');
  });

  it("keeps the numbering scope of a cross-reference target, climbing to the block level", () => {
    const result = buildSkeleton(fromXml(DEEP_BOOK), "ss222", {
      tocLevel: 0,
    });
    // "far" sits in s11 (level 2, the numbering level), so s11 is kept.
    expect(result?.content).toContain('<theorem xml:id="far">');
    expect(result?.content).not.toContain("Prose here.");
  });

  it("honours a deeper numbering level by keeping fewer siblings", () => {
    const result = buildSkeleton(fromXml(DEEP_BOOK), "ss222", {
      numberingLevel: 3,
    });
    // Numbered within subsections: the theorem before is not counted.
    expect(result?.content).toContain('xml:id="ss221"');
    expect(result?.content).not.toContain('<theorem xml:id="before">');
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

  // An xref target's chapter must not survive whole just because its section
  // does: the sibling sections of the target are shelled like any other.
  const WIDE_BOOK = BOOK.replace(
    `<section xml:id="s11">`,
    `<section xml:id="s10"><title>S10</title><p>Sibling prose.</p></section>
      <section xml:id="s11">`,
  );

  it("shells the siblings of a cross-reference target's division", () => {
    const { content } = skeletonOf(WIDE_BOOK, "s22");
    expect(content).toContain('<theorem xml:id="far">');
    expect(content).not.toContain("Sibling prose.");
    // The shell is still there, so numbering and the contents list hold.
    expect(content).toContain('xml:id="s10"');
  });

  // A target in an ancestor's own content — a chapter introduction — keeps
  // that content, stripped, without touching the previewed division.
  const INTRO_BOOK = BOOK.replace(
    `<chapter xml:id="c2"><title>C2</title>`,
    `<chapter xml:id="c2"><title>C2</title>
      <introduction><definition xml:id="intro-def"><statement><p>Intro prose.</p></statement></definition></introduction>`,
  ).replace(`<xref ref="near"/>`, `<xref ref="intro-def"/>`);

  it("keeps a target in an ancestor's introduction without stripping the preview", () => {
    const { content } = skeletonOf(INTRO_BOOK, "s22");
    expect(content).toContain('<definition xml:id="intro-def">');
    expect(content).not.toContain("Intro prose.");
    expect(content).toContain("Kept.");
  });

  describe("collapseChildren", () => {
    const NESTED = `<pretext>
  <book xml:id="bk"><title>Book</title>
    <chapter xml:id="c1"><title>C1</title>
      <introduction><p>Chapter intro. See <xref ref="deep"/>.</p></introduction>
      <section xml:id="s11"><title>S11</title><p>Section prose.</p>
        <subsection xml:id="ss111"><title>SS111</title><p>Deeper prose.</p></subsection>
      </section>
      <section xml:id="s12"><title>S12</title>
        <theorem xml:id="deep"><title>Deep</title><statement><p>Target prose.</p></statement></theorem>
      </section>
    </chapter>
  </book>
</pretext>`;

    it("keeps the division's own content and shells the divisions inside it", () => {
      const result = buildSkeleton(fromXml(NESTED), "c1", {
        collapseChildren: true,
      });
      expect(result?.collapsed).toBe(true);
      expect(result?.content).toContain("Chapter intro.");
      expect(result?.content).not.toContain("Section prose.");
      expect(result?.content).not.toContain("Deeper prose.");
      // Section headings survive, so the page still lists what follows;
      // the subsection is below the contents depth and goes.
      expect(result?.content).toContain("<title>S11</title>");
      expect(result?.content).not.toContain("<title>SS111</title>");
    });

    it("keeps a collapsed child that holds a cross-reference target, stripped", () => {
      const { content } = buildSkeleton(fromXml(NESTED), "c1", {
        collapseChildren: true,
      })!;
      expect(content).toContain('<theorem xml:id="deep">');
      expect(content).not.toContain("Target prose.");
    });

    it("reports collapsed: false when there is nothing to collapse", () => {
      const result = buildSkeleton(fromXml(NESTED), "ss111", {
        collapseChildren: true,
      });
      expect(result?.collapsed).toBe(false);
      expect(result?.content).toContain("Deeper prose.");
    });
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
