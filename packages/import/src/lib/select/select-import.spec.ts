import { describe, expect, it } from "vitest";
import { importProjectFromFiles, reselectImport } from "../upload";
import type { ImportedProjectSuccess } from "../types";
import { outlineDivisions } from "./divisions";

const QUIZZES = `<pretext>
  <article xml:id="doc">
    <title>Quizzes</title>
    <section xml:id="q1"><title>Quiz 1</title><p>One.</p></section>
    <section xml:id="q2"><title>Quiz 2</title><p>Two.</p></section>
    <section xml:id="q3"><title>Quiz 3</title><p>Three.</p></section>
  </article>
</pretext>`;

function importQuizzes(
  options: Parameters<typeof importProjectFromFiles>[1] = {},
): ImportedProjectSuccess {
  const result = importProjectFromFiles({ "quizzes.ptx": QUIZZES }, options);
  if ("pretextError" in result) {
    throw new Error(result.pretextError);
  }
  return result;
}

describe("cherry-picking into a new project", () => {
  it("converts only the divisions selected", () => {
    const result = importQuizzes({ selection: ["0", "2"], splitLevel: 1 });
    const main = result.outputFiles["source/main.ptx"];
    expect(main).toContain("sec-q1.ptx");
    expect(main).toContain("sec-q3.ptx");
    expect(main).not.toContain("sec-q2.ptx");
    expect(result.outputFiles["source/sec-q2.ptx"]).toBeUndefined();
  });

  it("still scaffolds a complete project around them", () => {
    const result = importQuizzes({ selection: ["1"], splitLevel: 1 });
    expect(result.outputFiles["project.ptx"]).toBeDefined();
    expect(result.outputFiles["publication/publication.ptx"]).toBeDefined();
  });

  it("says how many divisions were left out", () => {
    const result = importQuizzes({ selection: ["1"] });
    const warning = result.warnings.find(
      (w) => w.category === "unselected_divisions",
    );
    expect(warning?.occurrences).toBe(2);
  });

  it("imports everything when nothing is selected", () => {
    const result = importQuizzes({ splitLevel: 1 });
    expect(result.outputFiles["source/sec-q2.ptx"]).toBeDefined();
    expect(
      result.warnings.some((w) => w.category === "unselected_divisions"),
    ).toBe(false);
  });
});

describe("cherry-picking into an existing document", () => {
  const insertOptions = (selection?: string[]) => ({
    selection,
    destination: {
      kind: "insert" as const,
      targetTag: "subsection" as const,
      takenIds: new Set<string>(),
      hrefBase: "source/",
    },
  });

  it("inserts one division per pick, each in its own file", () => {
    const result = importQuizzes(insertOptions(["0", "2"]));
    expect(result.insert?.includes).toEqual([
      '<xi:include href="subsec-q1.ptx"/>',
      '<xi:include href="subsec-q3.ptx"/>',
    ]);
    expect(Object.keys(result.outputFiles)).toEqual([
      "source/subsec-q1.ptx",
      "source/subsec-q3.ptx",
    ]);
  });

  it("says that the document's own title and text are not carried across", () => {
    const result = importQuizzes(insertOptions(["0"]));
    const warning = result.warnings.find(
      (w) => w.category === "dropped_wrapper_content",
    );
    expect(warning?.message).toContain("not carried across");
  });

  it("says nothing about a wrapper that had nothing of its own", () => {
    const titleless = importProjectFromFiles(
      {
        "q.ptx": `<pretext><article>
  <section xml:id="q1"><title>Quiz 1</title><p>One.</p></section>
  <section xml:id="q2"><title>Quiz 2</title><p>Two.</p></section>
</article></pretext>`,
      },
      insertOptions(["0"]),
    );
    if ("pretextError" in titleless) {
      throw new Error(titleless.pretextError);
    }
    expect(
      titleless.warnings.some((w) => w.category === "dropped_wrapper_content"),
    ).toBe(false);
    expect(titleless.insert?.includes).toEqual([
      '<xi:include href="subsec-q1.ptx"/>',
    ]);
  });

  it("measures the attach level from what was kept, not what was dropped", () => {
    // The titleless-wrapper unwrap and the retarget both run *after* the prune,
    // so a selection that changes the document's shape changes them with it.
    const result = importQuizzes(insertOptions(["1"]));
    expect(result.outputFiles["source/subsec-q2.ptx"]).toContain(
      '<subsection xml:id="q2">',
    );
  });
});

describe("changing the selection after converting", () => {
  it("re-derives from the raw conversion rather than the pruned source", () => {
    const first = importQuizzes({ selection: ["0"], splitLevel: 1 });
    expect(first.outputFiles["source/sec-q3.ptx"]).toBeUndefined();

    // Widening has to reach divisions the first prune removed, which is only
    // possible because the prune restarts from the conversion.
    const wider = reselectImport(first, ["0", "2"]);
    expect(wider.outputFiles["source/sec-q3.ptx"]).toBeDefined();
    expect(wider.outputFiles["source/sec-q2.ptx"]).toBeUndefined();
  });

  it("restores the whole document when the selection is cleared", () => {
    const narrowed = importQuizzes({ selection: ["0"], splitLevel: 1 });
    const restored = reselectImport(narrowed, []);
    // Same files; a rebuild emits the carried-over scaffold first, so compare
    // the set rather than the order.
    expect(new Set(Object.keys(restored.outputFiles))).toEqual(
      new Set(Object.keys(importQuizzes({ splitLevel: 1 }).outputFiles)),
    );
    expect(
      restored.warnings.some((w) => w.category === "unselected_divisions"),
    ).toBe(false);
  });

  it("leaves one omission notice behind, not one per attempt", () => {
    const first = importQuizzes({ selection: ["0"], splitLevel: 1 });
    const thrice = reselectImport(
      reselectImport(reselectImport(first, ["1"]), ["2"]),
      ["0", "1"],
    );
    expect(
      thrice.warnings.filter((w) => w.category === "unselected_divisions"),
    ).toHaveLength(1);
  });

  it("keeps the outline addressable across a reselect", () => {
    const result = importQuizzes({ splitLevel: 1 });
    const outline = outlineDivisions(result.pretextSource);
    expect(outline.map((item) => item.title)).toEqual([
      "Quiz 1",
      "Quiz 2",
      "Quiz 3",
    ]);
    const narrowed = reselectImport(result, [outline[1].path]);
    expect(Object.keys(narrowed.outputFiles)).toContain("source/sec-q2.ptx");
  });
});
