import { describe, expect, it } from "vitest";
import { fileChangesForImport } from "./file-changes";
import { importProjectFromFiles, relayoutImport } from "./upload";
import type { ImportedProjectSuccess } from "./types";

const tex = [
  "\\documentclass{book}",
  "\\begin{document}",
  "\\chapter{Intro}",
  "{\\bf welcome} to the book",
  "\\section{Why}",
  "because \\bigskip it matters",
  "\\section{How}",
  "plain text with no problems",
  "\\chapter{Methods}",
  "\\hspace{2cm}indented",
  "\\end{document}",
].join("\n");

function importBook(splitLevel: number): ImportedProjectSuccess {
  const result = importProjectFromFiles({ "main.tex": tex }, { splitLevel });
  if ("pretextError" in result) throw new Error(result.pretextError);
  return result;
}

describe("fileChangesForImport", () => {
  it("attaches a before/after record to each generated file", () => {
    const records = fileChangesForImport(importBook(1));
    expect(records.map((r) => r.title)).toEqual(
      expect.arrayContaining(["Intro", "Methods"]),
    );
    expect(records.every((r) => r.path.endsWith(".ptx"))).toBe(true);
  });

  it("shows the cleaning that happened in that file only", () => {
    const records = fileChangesForImport(importBook(2));
    const why = records.find((r) => r.title === "Why")!;
    expect(why.before).toContain("\\bigskip");
    expect(why.after).not.toContain("\\bigskip");
    expect(why.before).not.toContain("welcome");
  });

  it("reports no changes for a file nothing touched", () => {
    const how = fileChangesForImport(importBook(2)).find(
      (r) => r.title === "How",
    )!;
    expect(how.stats).toEqual({ added: 0, removed: 0 });
    expect(how.hunks).toEqual([]);
    expect(how.fixCount).toBe(0);
  });

  it("counts the fixes applied in each file", () => {
    const records = fileChangesForImport(importBook(2));
    expect(records.find((r) => r.title === "Intro")!.fixCount).toBeGreaterThan(
      0,
    );
    expect(
      records.find((r) => r.title === "Methods")!.fixCount,
    ).toBeGreaterThan(0);
  });

  it("re-attributes when the split depth changes", () => {
    const atOne = fileChangesForImport(importBook(1));
    const atTwo = fileChangesForImport(relayoutImport(importBook(1), 2), 2);
    // At depth 1 a chapter's sections are folded into it; at depth 2 they are not.
    expect(atOne.find((r) => r.title === "Intro")!.before).toContain("bigskip");
    expect(atTwo.find((r) => r.title === "Intro")!.before).not.toContain(
      "bigskip",
    );
  });

  it("produces hunks a diff view can render", () => {
    const intro = fileChangesForImport(importBook(2)).find(
      (r) => r.title === "Intro",
    )!;
    const ops = intro.hunks.flatMap((h) => h.lines).map((l) => l.op);
    expect(ops).toContain("remove");
    expect(ops).toContain("add");
  });

  it("skips files whose division title is ambiguous", () => {
    const dupes = [
      "\\documentclass{book}",
      "\\begin{document}",
      "\\chapter{Same}",
      "{\\bf a}",
      "\\chapter{Same}",
      "{\\bf b}",
      "\\end{document}",
    ].join("\n");
    const result = importProjectFromFiles(
      { "main.tex": dupes },
      { splitLevel: 1 },
    );
    if ("pretextError" in result) throw new Error(result.pretextError);
    expect(
      fileChangesForImport(result).filter((r) => r.title === "Same"),
    ).toHaveLength(0);
  });

  it("returns nothing for input that was never cleaned", () => {
    const result = importProjectFromFiles({
      "main.ptx":
        "<pretext><article><title>T</title><p>hi</p></article></pretext>",
    });
    if ("pretextError" in result) throw new Error(result.pretextError);
    expect(fileChangesForImport(result)).toEqual([]);
  });
});
