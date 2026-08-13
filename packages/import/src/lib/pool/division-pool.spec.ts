import { describe, expect, it } from "vitest";
import { buildDivisionPool, sanitizeRef } from "./division-pool";

const BOOK_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
<docinfo>
  <macros>\\newcommand{\\N}{\\mathbb N}</macros>
</docinfo>
<book>
<title>My <em>Great</em> Book</title>
<chapter xml:id="intro">
<title>Introduction</title>
<p>Welcome.</p>
</chapter>
<chapter xml:id="methods">
<title>Methods</title>
<section xml:id="setup">
<title>Setup</title>
<p>Details.</p>
</section>
<section>
<title>Analysis</title>
<p>More details.</p>
</section>
</chapter>
</book>
</pretext>
`;

describe("sanitizeRef", () => {
  it("keeps valid refs unchanged", () => {
    expect(sanitizeRef("ch-intro_2")).toBe("ch-intro_2");
  });

  it("collapses invalid characters and strips bad leading characters", () => {
    expect(sanitizeRef("1.intro fun")).toBe("intro-fun");
    expect(sanitizeRef("  §weird  ")).toBe("weird");
  });

  it("returns empty when nothing valid remains", () => {
    expect(sanitizeRef("123")).toBe("");
  });
});

describe("buildDivisionPool", () => {
  it("extracts docinfo, title, and splits chapters into divisions", () => {
    const { project, warnings } = buildDivisionPool(BOOK_SOURCE);

    expect(project.documentKind).toBe("book");
    expect(project.title).toBe("My Great Book");
    expect(project.docinfo).toContain("<macros>");
    expect(project.docinfo.startsWith("<docinfo>")).toBe(true);

    const roots = project.divisions.filter((d) => d.isRoot);
    expect(roots).toHaveLength(1);
    const root = roots[0];
    expect(root.type).toBe("book");
    expect(root.xmlId).toBe("document");
    expect(root.content).toContain('xml:id="document"');
    expect(root.content).toContain('<plus:chapter ref="intro"/>');
    expect(root.content).toContain('<plus:chapter ref="methods"/>');
    expect(root.content).not.toContain("<docinfo>");
    expect(root.content).not.toContain("Welcome.");

    const intro = project.divisions.find((d) => d.xmlId === "intro");
    expect(intro?.type).toBe("chapter");
    expect(intro?.title).toBe("Introduction");
    expect(intro?.sourceFormat).toBe("pretext");
    expect(intro?.content).toContain("Welcome.");

    // No section splitting by default: methods keeps its sections inline.
    const methods = project.divisions.find((d) => d.xmlId === "methods");
    expect(methods?.content).toContain("<section");
    expect(methods?.content).not.toContain("<plus:section");

    expect(warnings).toHaveLength(0);
  });

  it("splits sections when requested, generating chapter-scoped refs", () => {
    const { project } = buildDivisionPool(BOOK_SOURCE, {
      splitSections: true,
    });

    const methods = project.divisions.find((d) => d.xmlId === "methods");
    expect(methods?.content).toContain('<plus:section ref="setup"/>');
    expect(methods?.content).toContain('<plus:section ref="methods-sec-02"/>');
    expect(methods?.content).not.toContain("Details.");

    const generated = project.divisions.find(
      (d) => d.xmlId === "methods-sec-02",
    );
    expect(generated?.type).toBe("section");
    expect(generated?.title).toBe("Analysis");
    expect(generated?.content).toContain('xml:id="methods-sec-02"');
  });

  it("splits handout, introduction, and conclusion divisions and their contents", () => {
    const source = `<pretext><article xml:id="art">
  <title>Doc</title>
  <section xml:id="sec-a">
    <title>Sec A</title>
    <subsection xml:id="sub-a1"><title>A1</title><p>x</p></subsection>
  </section>
  <handout xml:id="hand-a">
    <title>Handout</title>
    <subsection xml:id="hand-sub-1"><title>H1</title><p>y</p></subsection>
    <subsection xml:id="hand-sub-2"><title>H2</title><p>z</p></subsection>
  </handout>
  <worksheet xml:id="ws-a">
    <title>Worksheet</title>
    <subsection xml:id="ws-sub-1"><title>W1</title><p>w</p></subsection>
  </worksheet>
</article></pretext>`;

    const { project } = buildDivisionPool(source, { splitLevel: 3 });

    const root = project.divisions.find((d) => d.isRoot);
    expect(root?.content).toContain('<plus:handout ref="hand-a"/>');
    expect(root?.content).not.toContain("<subsection");

    const handout = project.divisions.find((d) => d.xmlId === "hand-a");
    expect(handout?.type).toBe("handout");
    expect(handout?.content).toContain('<plus:subsection ref="hand-sub-1"/>');
    expect(handout?.content).toContain('<plus:subsection ref="hand-sub-2"/>');
    expect(handout?.content).not.toContain("H1");

    expect(
      project.divisions.find((d) => d.xmlId === "hand-sub-1")?.content,
    ).toContain("<p>y</p>");
    expect(
      project.divisions.find((d) => d.xmlId === "hand-sub-2")?.content,
    ).toContain("<p>z</p>");
  });

  it("splits introduction and conclusion out of a chapter", () => {
    const source = `<pretext><book><title>T</title>
<chapter xml:id="ch-1">
  <title>One</title>
  <introduction xml:id="ch-1-intro"><p>intro</p></introduction>
  <section xml:id="ch-1-sec"><title>S</title><p>body</p></section>
  <conclusion xml:id="ch-1-outro"><p>outro</p></conclusion>
</chapter>
</book></pretext>`;

    const { project } = buildDivisionPool(source, { splitLevel: 2 });

    const chapter = project.divisions.find((d) => d.xmlId === "ch-1");
    expect(chapter?.content).toContain('<plus:introduction ref="ch-1-intro"/>');
    expect(chapter?.content).toContain('<plus:conclusion ref="ch-1-outro"/>');
    expect(chapter?.content).not.toContain("<p>intro</p>");
    expect(chapter?.content).not.toContain("<p>outro</p>");

    expect(
      project.divisions.find((d) => d.xmlId === "ch-1-intro")?.content,
    ).toContain("<p>intro</p>");
    expect(
      project.divisions.find((d) => d.xmlId === "ch-1-outro")?.content,
    ).toContain("<p>outro</p>");
  });

  it("generates ids for chapters without xml:id and warns", () => {
    const source = `<pretext><book><title>T</title>
<chapter><title>One</title><p>a</p></chapter>
<chapter><title>Two</title><p>b</p></chapter>
</book></pretext>`;
    const { project, warnings } = buildDivisionPool(source);

    const chapters = project.divisions.filter((d) => d.type === "chapter");
    expect(chapters.map((c) => c.xmlId)).toEqual(["ch-01", "ch-02"]);
    expect(chapters[0].content).toContain('<chapter xml:id="ch-01">');
    expect(
      warnings.filter((w) => w.category === "missing_xml_id"),
    ).toHaveLength(2);
  });

  it("renames invalid or duplicate xml:ids with a warning", () => {
    const source = `<pretext><book><title>T</title>
<chapter xml:id="1.intro"><title>One</title></chapter>
<chapter xml:id="same"><title>Two</title></chapter>
<chapter xml:id="same"><title>Three</title></chapter>
</book></pretext>`;
    const { project, warnings } = buildDivisionPool(source);

    const ids = project.divisions
      .filter((d) => d.type === "chapter")
      .map((d) => d.xmlId);
    expect(ids).toEqual(["intro", "same", "same-2"]);
    const renames = warnings.filter((w) => w.category === "renamed_xml_id");
    expect(renames).toHaveLength(2);
    // The renamed division's content carries the new id.
    const third = project.divisions.find((d) => d.xmlId === "same-2");
    expect(third?.content).toContain('xml:id="same-2"');
  });

  it("keeps an article as a single root division", () => {
    const source = `<pretext><article><title>Note</title><p>Hi</p></article></pretext>`;
    const { project } = buildDivisionPool(source);

    expect(project.documentKind).toBe("article");
    expect(project.divisions).toHaveLength(1);
    expect(project.divisions[0].type).toBe("article");
    expect(project.divisions[0].content).toContain("<p>Hi</p>");
  });

  it("wraps a bare chapter fragment in a book root", () => {
    const source = `<chapter xml:id="solo"><title>Solo</title><p>x</p></chapter>`;
    const { project } = buildDivisionPool(source);

    expect(project.documentKind).toBe("book");
    const root = project.divisions.find((d) => d.isRoot);
    expect(root?.type).toBe("book");
    expect(root?.content).toContain('<plus:chapter ref="solo"/>');
    expect(project.divisions.find((d) => d.xmlId === "solo")).toBeDefined();
  });

  it("assigns refs to assets, deduplicating against divisions", () => {
    const source = `<pretext><book><title>T</title>
<chapter xml:id="intro"><title>One</title></chapter>
</book></pretext>`;
    const { project } = buildDivisionPool(source, {
      assets: {
        "figs/intro.png": new Uint8Array([1]),
        "other/intro.png": new Uint8Array([2]),
      },
    });

    const refs = project.assets.map((a) => a.ref);
    // "intro" is taken by the chapter, so both assets get suffixes.
    expect(refs).toEqual(["intro-2", "intro-3"]);
    expect(project.assets[0].fileName).toBe("intro.png");
    expect(project.assets[0].data).toEqual(new Uint8Array([1]));
  });
});
