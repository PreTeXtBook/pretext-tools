import { describe, expect, it } from "vitest";
import { importProjectFromFiles } from "../upload";
import type { ImportedProjectSuccess } from "../types";
import { serializeInsertToRecords } from "./serialize-insert-records";
import { serializeProjectToRecords } from "./serialize-records";

function insert(
  source: string,
  extra: Record<string, unknown> = {},
): ImportedProjectSuccess {
  const result = importProjectFromFiles(
    { "in.ptx": source },
    {
      destination: {
        kind: "insert",
        targetTag: "subsection",
        takenIds: new Set<string>(),
        hrefBase: "source/",
      },
      ...extra,
    },
  );
  if ("pretextError" in result) {
    throw new Error(result.pretextError);
  }
  return result;
}

/** Records for an insert, reading the shape decisions off the result. */
function recordsFor(result: ImportedProjectSuccess) {
  if (result.destination.kind !== "insert") {
    throw new Error("not an insert");
  }
  return serializeInsertToRecords(result.project, {
    targetTag: result.destination.targetTag,
    unwrapRoot: result.insert?.unwrapRoot ?? false,
  });
}

const TITLED = `<pretext><article xml:id="hw">
  <title>Homework 3</title>
  <p>Prove it.</p>
</article></pretext>`;

const PILE = `<pretext><article>
  <section xml:id="q1"><title>Quiz 1</title><p>One.</p></section>
  <section xml:id="q2"><title>Quiz 2</title><p>Two.</p></section>
</article></pretext>`;

describe("serializeInsertToRecords: a wrapper that survives", () => {
  it("retypes the wrapper to the attach level", () => {
    const records = recordsFor(insert(TITLED));
    expect(records.divisions[0].ref).toBe("hw");
    expect(records.divisions[0].source).toContain('<subsection xml:id="hw">');
    expect(records.divisions[0].source).not.toContain("<article");
  });

  it("gives the host one placeholder to write into the parent", () => {
    expect(recordsFor(insert(TITLED)).placeholders).toEqual([
      '<plus:subsection ref="hw"/>',
    ]);
  });
});

describe("serializeInsertToRecords: a wrapper that is dropped", () => {
  it("emits a record per inserted division and none for the wrapper", () => {
    const records = recordsFor(insert(PILE));
    expect(records.divisions.map((d) => d.ref)).toEqual(["q1", "q2"]);
    expect(records.divisions.every((d) => !d.isRoot)).toBe(true);
  });

  it("gives the host one placeholder per division, in document order", () => {
    expect(recordsFor(insert(PILE)).placeholders).toEqual([
      '<plus:subsection ref="q1"/>',
      '<plus:subsection ref="q2"/>',
    ]);
  });

  it("agrees with the file projection on what is being inserted", () => {
    const result = insert(PILE);
    const refs = recordsFor(result).divisions.map((d) => d.ref);
    const hrefs = (result.insert?.includes ?? []).map(
      (include) => include.match(/href="([^"]+)"/)?.[1] ?? "",
    );
    expect(hrefs).toEqual(refs.map((ref) => `subsec-${ref}.ptx`));
  });
});

describe("serializeInsertToRecords: deeper divisions", () => {
  it("carries the divisions beneath an inserted one", () => {
    const result = insert(
      `<pretext><article>
  <section xml:id="q1"><title>Quiz 1</title>
    <subsection xml:id="q1a"><title>Part A</title><p>One.</p></subsection>
  </section>
</article></pretext>`,
      { splitLevel: 2 },
    );
    const records = recordsFor(result);
    expect(records.divisions.map((d) => d.ref)).toEqual(["q1", "q1a"]);
    // Hierarchy stays in the placeholder, which is what a record host stores.
    expect(records.divisions[0].source).toContain(
      '<plus:subsubsection ref="q1a"/>',
    );
    expect(records.placeholders).toEqual(['<plus:subsection ref="q1"/>']);
  });
});

describe("serializeProjectToRecords: the whole-project projection", () => {
  it("is unchanged by the insert branch", () => {
    const result = importProjectFromFiles(
      { "in.ptx": PILE },
      { splitLevel: 1 },
    );
    if ("pretextError" in result) {
      throw new Error(result.pretextError);
    }
    const records = serializeProjectToRecords(result.project);
    expect(records.divisions.filter((d) => d.isRoot)).toHaveLength(1);
    expect(records.documentKind).toBe("article");
  });
});
