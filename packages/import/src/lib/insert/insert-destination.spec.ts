import { describe, expect, it } from "vitest";
import { buildDivisionPool } from "../pool/division-pool";
import {
  importProjectFromFiles,
  relayoutImport,
  retargetImport,
} from "../upload";
import type { ImportedProjectSuccess } from "../types";
import type { InsertDestination } from "./destination";

function insertInto(
  files: Record<string, string>,
  destination: Partial<InsertDestination> = {},
): ImportedProjectSuccess {
  const result = importProjectFromFiles(files, {
    destination: {
      kind: "insert",
      targetTag: "subsection",
      takenIds: new Set<string>(),
      hrefBase: "source/",
      ...destination,
    },
  });
  if ("pretextError" in result) {
    throw new Error(result.pretextError);
  }
  return result;
}

const HW3_TEX = `\\documentclass{article}
\\begin{document}
\\section{Homework 3}
Prove that $n^2$ is even when $n$ is even.
\\end{document}`;

describe("insert destination: what gets written", () => {
  it("writes one file per inserted division and no scaffold", () => {
    const result = insertInto({ "hw3.tex": HW3_TEX });
    expect(Object.keys(result.outputFiles)).toEqual([
      "source/subsec-homework-3.ptx",
    ]);
    expect(result.outputFiles["project.ptx"]).toBeUndefined();
    expect(result.outputFiles["publication/publication.ptx"]).toBeUndefined();
  });

  it("returns the include the host splices in at the cursor", () => {
    const result = insertInto({ "hw3.tex": HW3_TEX });
    expect(result.insert?.includes).toEqual([
      '<xi:include href="subsec-homework-3.ptx"/>',
    ]);
  });

  it("retargets the document onto the chosen level", () => {
    const result = insertInto({ "hw3.tex": HW3_TEX });
    expect(result.outputFiles["source/subsec-homework-3.ptx"]).toContain(
      '<subsection xml:id="homework-3">',
    );
    expect(result.insert?.retargetDelta).toBe(1);
  });

  it("writes hrefs relative to the file receiving the include", () => {
    const result = insertInto(
      { "hw3.tex": HW3_TEX },
      { hrefBase: "source/chapters/" },
    );
    expect(Object.keys(result.outputFiles)).toEqual([
      "source/chapters/subsec-homework-3.ptx",
    ]);
    expect(result.insert?.includes[0]).toBe(
      '<xi:include href="subsec-homework-3.ptx"/>',
    );
  });

  it("names files after titles rather than positions", () => {
    // `subsec-01.ptx` is a fine name in a project the import created and a
    // poor one dropped into a project that already exists.
    const result = insertInto({ "hw3.tex": HW3_TEX });
    expect(Object.keys(result.outputFiles)[0]).toContain("homework-3");
  });
});

describe("insert destination: the document wrapper", () => {
  it("keeps a wrapper that carries a title of its own", () => {
    const result = insertInto({
      "notes.tex": `\\documentclass{article}
\\title{Field Notes}
\\begin{document}
\\maketitle
Some prose.
\\end{document}`,
    });
    expect(result.insert?.unwrapRoot).toBe(false);
    expect(result.outputFiles["source/subsec-field-notes.ptx"]).toContain(
      "<title>Field Notes</title>",
    );
  });

  it("drops a titleless wrapper whose children are all divisions", () => {
    const result = insertInto({
      "quizzes.ptx": `<pretext><article>
  <section xml:id="q1"><title>Quiz 1</title><p>One.</p></section>
  <section xml:id="q2"><title>Quiz 2</title><p>Two.</p></section>
</article></pretext>`,
    });
    expect(result.insert?.unwrapRoot).toBe(true);
    expect(result.insert?.includes).toEqual([
      '<xi:include href="subsec-q1.ptx"/>',
      '<xi:include href="subsec-q2.ptx"/>',
    ]);
    expect(result.outputFiles["source/subsec-q1.ptx"]).toContain(
      '<subsection xml:id="q1">',
    );
  });

  it("warns when a surviving wrapper has no title to give its division", () => {
    const result = insertInto({
      "loose.ptx": `<pretext><article><p>Just some prose.</p></article></pretext>`,
    });
    expect(result.insert?.unwrapRoot).toBe(false);
    expect(result.warnings.some((w) => w.category === "missing_title")).toBe(
      true,
    );
  });
});

describe("insert destination: collisions with the host project", () => {
  const COLLIDING = `<pretext><article xml:id="doc">
  <title>Extras</title>
  <section xml:id="sec-intro">
    <title>Intro</title>
    <p>See <xref ref="sec-intro"/>.</p>
  </section>
</article></pretext>`;

  it("renames an id the host already uses and follows it with the xref", () => {
    const result = insertInto(
      { "extras.ptx": COLLIDING },
      { takenIds: new Set(["sec-intro"]) },
    );
    const renamed = result.insert?.renamed ?? [];
    expect(renamed.map((r) => r.from)).toEqual(["sec-intro"]);
    const to = renamed[0].to;
    const prepared = result.insert?.preparedSource ?? "";
    expect(prepared).toContain(`<xref ref="${to}"/>`);
    expect(prepared).not.toContain('ref="sec-intro"');
    // The raw conversion is kept as it was, so the attach level can change
    // later without shifting an already-shifted document a second time.
    expect(result.pretextSource).toContain('xml:id="sec-intro"');
  });

  it("reports the renames as a warning the host can surface", () => {
    const result = insertInto(
      { "extras.ptx": COLLIDING },
      { takenIds: new Set(["sec-intro"]) },
    );
    expect(result.warnings.some((w) => w.category === "renamed_xml_id")).toBe(
      true,
    );
  });

  it("keeps generated fallback ids clear of the host's too", () => {
    // dedupeXmlIds settles ids the source already carries; these are minted
    // afterwards, inside the pool, so the pool has to know the host's ids.
    const pool = buildDivisionPool(
      `<pretext><article><title>D</title>
         <section><title>A</title></section>
         <section><title>B</title></section>
       </article></pretext>`,
      { splitLevel: 1, takenIds: new Set(["sec-01"]) },
    );
    const ids = pool.project.divisions.map((d) => d.xmlId);
    expect(ids).not.toContain("sec-01");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("insert destination: levels and overflow", () => {
  it("shifts nested divisions below the attachment point", () => {
    const result = insertInto({
      "part.ptx": `<pretext><article xml:id="doc">
  <title>Extras</title>
  <section xml:id="s"><title>S</title><p>Text.</p></section>
</article></pretext>`,
    });
    // The wrapper becomes the subsection, so its section goes one deeper.
    expect(result.insert?.preparedSource).toContain(
      '<subsubsection xml:id="s">',
    );
  });

  it("warns when inserting deep enough to overflow into paragraphs", () => {
    const result = insertInto(
      {
        "deep.ptx": `<pretext><article xml:id="doc">
  <title>Extras</title>
  <section xml:id="s"><title>S</title>
    <subsection xml:id="ss"><title>SS</title><p>Text.</p></subsection>
  </section>
</article></pretext>`,
      },
      { targetTag: "subsection" },
    );
    expect(result.insert?.preparedSource).toContain("<paragraphs");
    expect(
      result.warnings.some((w) => w.category === "division_overflow"),
    ).toBe(true);
  });
});

describe("insert destination: relayout", () => {
  it("does not regenerate a project scaffold when the split dial moves", () => {
    const result = insertInto({
      "quizzes.ptx": `<pretext><article>
  <section xml:id="q1"><title>Quiz 1</title>
    <subsection xml:id="q1a"><title>Part A</title><p>One.</p></subsection>
  </section>
</article></pretext>`,
    });
    const deeper = relayoutImport(result, 2);
    expect(deeper.outputFiles["project.ptx"]).toBeUndefined();
    expect(deeper.outputFiles["publication/publication.ptx"]).toBeUndefined();
    expect(deeper.insert?.includes).toEqual([
      '<xi:include href="subsec-q1.ptx"/>',
    ]);
    expect(deeper.outputFiles["source/subsec-q1/subsubsec-q1a.ptx"]).toContain(
      '<subsubsection xml:id="q1a">',
    );
  });

  it("refuses to relayout an unwrapped insert below one level", () => {
    const result = insertInto({
      "quizzes.ptx": `<pretext><article>
  <section xml:id="q1"><title>Quiz 1</title><p>One.</p></section>
</article></pretext>`,
    });
    // Level 0 would leave the pool holding only the wrapper that was dropped,
    // so there would be nothing to insert.
    expect(relayoutImport(result, 0).splitLevel).toBe(1);
  });
});

describe("insert destination: changing the attach level", () => {
  const QUIZ = `<pretext><article xml:id="doc">
  <title>Quizzes</title>
  <section xml:id="q1"><title>Quiz 1</title><p>One.</p></section>
</article></pretext>`;

  it("re-derives the level from the raw conversion, not the shifted one", () => {
    const first = insertInto({ "q.ptx": QUIZ }, { targetTag: "subsection" });
    expect(first.insert?.preparedSource).toContain(
      '<subsubsection xml:id="q1">',
    );

    // Shifting an already-shifted document would land at <paragraphs>; starting
    // over from the conversion lands where the author asked.
    const moved = retargetImport(first, "chapter");
    expect(moved.insert?.preparedSource).toContain('<section xml:id="q1">');
    // Named for the root's own xml:id, which the author wrote; only an
    // unnamed unit falls back to its title.
    expect(moved.outputFiles["source/ch-doc.ptx"]).toContain("<chapter");
  });

  it("goes back to where it started when the level is set back", () => {
    const first = insertInto({ "q.ptx": QUIZ }, { targetTag: "subsection" });
    const roundTrip = retargetImport(
      retargetImport(first, "chapter"),
      "subsection",
    );
    expect(roundTrip.outputFiles).toEqual(first.outputFiles);
    expect(roundTrip.insert?.includes).toEqual(first.insert?.includes);
  });

  it("replaces the previous level's warnings rather than piling them up", () => {
    const deep = insertInto(
      {
        "q.ptx": `<pretext><article xml:id="doc">
  <title>Quizzes</title>
  <section xml:id="q1"><title>Quiz 1</title>
    <subsection xml:id="q1a"><title>Part A</title><p>One.</p></subsection>
  </section>
</article></pretext>`,
      },
      { targetTag: "subsection" },
    );
    const overflowCount = (r: ImportedProjectSuccess) =>
      r.warnings.filter((w) => w.category === "division_overflow").length;
    expect(overflowCount(deep)).toBe(1);

    const shallower = retargetImport(deep, "chapter");
    expect(overflowCount(shallower)).toBe(0);
    expect(overflowCount(retargetImport(shallower, "subsection"))).toBe(1);
  });

  it("leaves a new-project import alone", () => {
    const result = importProjectFromFiles({ "hw3.tex": HW3_TEX });
    if ("pretextError" in result) throw new Error(result.pretextError);
    expect(retargetImport(result, "chapter")).toBe(result);
  });
});

describe("project destination: unchanged by the new branch", () => {
  it("still scaffolds a whole project by default", () => {
    const result = importProjectFromFiles({ "hw3.tex": HW3_TEX });
    if ("pretextError" in result) throw new Error(result.pretextError);
    expect(result.destination.kind).toBe("project");
    expect(result.insert).toBeUndefined();
    expect(result.outputFiles["project.ptx"]).toBeDefined();
    expect(result.outputFiles["source/main.ptx"]).toContain("<pretext>");
  });
});
