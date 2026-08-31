import { describe, expect, it } from "vitest";
import { outlineDivisions, pruneDivisions } from "./divisions";

const QUIZZES = `<pretext>
  <article xml:id="doc">
    <title>Quizzes</title>
    <p>Some notes for the instructor.</p>
    <section xml:id="q1"><title>Quiz 1</title>
      <subsection xml:id="q1a"><title>Part A</title><p>One.</p></subsection>
      <subsection xml:id="q1b"><title>Part B</title><p>Two.</p></subsection>
    </section>
    <section xml:id="q2"><title>Quiz 2</title><p>Three.</p></section>
    <section xml:id="q3"><title>Quiz 3</title><p>Four.</p></section>
  </article>
</pretext>`;

describe("outlineDivisions", () => {
  it("addresses divisions by position, outermost first", () => {
    const outline = outlineDivisions(QUIZZES);
    expect(outline.map((item) => item.path)).toEqual(["0", "1", "2"]);
    expect(outline[0].children.map((item) => item.path)).toEqual([
      "0.0",
      "0.1",
    ]);
  });

  it("carries what a picker needs to label each division", () => {
    const [first] = outlineDivisions(QUIZZES);
    expect(first).toMatchObject({
      tag: "section",
      title: "Quiz 1",
      xmlId: "q1",
    });
  });

  it("takes a division's own title, not one from inside it", () => {
    const outline = outlineDivisions(
      `<article><section><title>Outer</title><theorem><title>Inner</title></theorem></section></article>`,
    );
    expect(outline[0].title).toBe("Outer");
  });

  it("reports no id for a division that has none yet", () => {
    const outline = outlineDivisions(
      `<article><section><title>S</title></section></article>`,
    );
    expect(outline[0].xmlId).toBeUndefined();
  });

  it("is empty for a document with no divisions", () => {
    expect(outlineDivisions(`<article><p>Just prose.</p></article>`)).toEqual(
      [],
    );
  });
});

describe("pruneDivisions: what a selection keeps", () => {
  it("keeps a selected division whole, subdivisions included", () => {
    const { source } = pruneDivisions(QUIZZES, ["0"]);
    expect(source).toContain('xml:id="q1"');
    expect(source).toContain('xml:id="q1a"');
    expect(source).toContain('xml:id="q1b"');
  });

  it("drops the divisions the selection does not reach", () => {
    const { source, removed } = pruneDivisions(QUIZZES, ["0"]);
    expect(source).not.toContain('xml:id="q2"');
    expect(source).not.toContain('xml:id="q3"');
    expect(removed).toEqual(["1", "2"]);
  });

  it("keeps several picks in document order", () => {
    const { source } = pruneDivisions(QUIZZES, ["0", "2"]);
    expect(source.indexOf("Quiz 1")).toBeLessThan(source.indexOf("Quiz 3"));
    expect(source).not.toContain("Quiz 2");
  });

  it("keeps a parent as structure when only a child is picked", () => {
    const { source } = pruneDivisions(QUIZZES, ["0.1"]);
    expect(source).toContain('xml:id="q1"');
    expect(source).toContain('xml:id="q1b"');
    expect(source).not.toContain('xml:id="q1a"');
    expect(source).not.toContain('xml:id="q2"');
  });

  it("keeps content belonging to a kept division but to none of its children", () => {
    // The instructor's note is the article's own, and the author never
    // deselected it — there is nothing in the picker that stands for it.
    const { source } = pruneDivisions(QUIZZES, ["1"]);
    expect(source).toContain("Some notes for the instructor.");
  });

  it("does not mistake a sibling for a descendant", () => {
    const many = `<article>${Array.from(
      { length: 12 },
      (_, i) => `<section xml:id="s${i}"><title>S${i}</title></section>`,
    ).join("")}</article>`;
    const { source } = pruneDivisions(many, ["1"]);
    // "1" must not keep "10" and "11" just because their paths start with "1".
    expect(source).toContain('xml:id="s1"');
    expect(source).not.toContain('xml:id="s10"');
    expect(source).not.toContain('xml:id="s11"');
  });
});

describe("pruneDivisions: expressing no selection", () => {
  it("leaves the document alone when nothing is passed", () => {
    expect(pruneDivisions(QUIZZES, undefined).source).toBe(QUIZZES);
  });

  it("treats an empty selection as no narrowing, not as nothing", () => {
    const { source, removed } = pruneDivisions(QUIZZES, []);
    expect(source).toBe(QUIZZES);
    expect(removed).toEqual([]);
  });

  it("survives a selection naming a division that is not there", () => {
    const { source } = pruneDivisions(QUIZZES, ["7"]);
    expect(source).not.toContain("Quiz 1");
    expect(source).toContain("Some notes for the instructor.");
  });
});

describe("pruneDivisions: round trip with the outline", () => {
  it("keeps exactly the divisions whose paths were selected", () => {
    const selection = ["0.0", "2"];
    const { source } = pruneDivisions(QUIZZES, selection);
    const kept = outlineDivisions(source);
    expect(kept.map((item) => item.title)).toEqual(["Quiz 1", "Quiz 3"]);
    expect(kept[0].children.map((item) => item.title)).toEqual(["Part A"]);
  });
});
