import { describe, expect, it } from "vitest";
import { cleanLatexInChunks, mergeChunksAtLevel } from "./clean-chunks";

const doc = [
  "\\documentclass{book}",
  "\\setlength{\\parindent}{0pt}",
  "\\begin{document}",
  "\\chapter{One}",
  "{\\bf lead} text",
  "\\section{Alpha}",
  "alpha \\bigskip text",
  "\\section{Beta}",
  "beta text",
  "\\chapter{Two}",
  "two \\vspace*{ 2 cm } text",
  "\\end{document}",
].join("\n");

describe("cleanLatexInChunks", () => {
  it("cuts the body at every division header", () => {
    const { chunks } = cleanLatexInChunks(doc);
    expect(chunks.map((c) => `${c.kind}:${c.title}`)).toEqual([
      "preamble:",
      "division:One",
      "division:Alpha",
      "division:Beta",
      "division:Two",
    ]);
  });

  it("records the heading path for each chunk", () => {
    const { chunks } = cleanLatexInChunks(doc);
    expect(chunks.find((c) => c.title === "Alpha")?.path).toEqual([
      "One",
      "Alpha",
    ]);
    expect(chunks.find((c) => c.title === "Two")?.path).toEqual(["Two"]);
  });

  it("gives each chunk a before/after pair covering only its own text", () => {
    const alpha = cleanLatexInChunks(doc).chunks.find(
      (c) => c.title === "Alpha",
    )!;
    expect(alpha.before).toContain("\\bigskip");
    expect(alpha.after).not.toContain("\\bigskip");
    expect(alpha.before).not.toContain("Beta");
  });

  it("attributes each fix to the chunk it came from", () => {
    const { chunks } = cleanLatexInChunks(doc);
    const one = chunks.find((c) => c.title === "One")!;
    const alpha = chunks.find((c) => c.title === "Alpha")!;
    expect(one.fixes.map((f) => f.ruleId)).toContain("tex-font-bf");
    expect(alpha.fixes.map((f) => f.ruleId)).toContain("bigskip");
    expect(alpha.fixes.map((f) => f.ruleId)).not.toContain("tex-font-bf");
  });

  it("cleans the preamble with preamble scope", () => {
    const preamble = cleanLatexInChunks(doc).chunks[0];
    expect(preamble.before).toContain("\\setlength");
    expect(preamble.after).not.toContain("\\setlength");
  });

  it("reassembles into a document equivalent to whole-document cleaning", () => {
    const { output } = cleanLatexInChunks(doc);
    expect(output).toContain("\\begin{document}");
    expect(output).toContain("\\textbf{lead}");
    expect(output).not.toContain("\\bigskip");
    expect(output).toContain("\\vspace{2cm}");
  });

  it("concatenating every chunk's `before` reproduces the body exactly", () => {
    const { chunks } = cleanLatexInChunks(doc);
    const body = chunks
      .filter((c) => c.kind !== "preamble")
      .map((c) => c.before)
      .join("");
    expect(body).toContain("\\chapter{One}");
    expect(body).toContain("\\chapter{Two}");
    expect(body.indexOf("Alpha")).toBeLessThan(body.indexOf("Beta"));
  });

  it("rolls the per-chunk fixes up into document-level warnings", () => {
    const { warnings } = cleanLatexInChunks(doc);
    expect(warnings.map((w) => w.macro)).toEqual(
      expect.arrayContaining(["bf", "bigskip", "setlength"]),
    );
  });

  it("folds whitespace before the first heading into that heading's chunk", () => {
    expect(cleanLatexInChunks(doc).chunks.some((c) => c.kind === "lead")).toBe(
      false,
    );
  });

  it("keeps real text before the first heading as its own chunk", () => {
    const { chunks } = cleanLatexInChunks(
      "\\documentclass{article}\n\\begin{document}\nfront matter prose\n\\section{A}\nx",
    );
    expect(chunks.map((c) => c.kind)).toEqual(["preamble", "lead", "division"]);
  });

  it("keeps \\begin{document} when the preamble is empty", () => {
    const { output } = cleanLatexInChunks("\\begin{document}\n\\section{A}\nx");
    expect(output).toContain("\\begin{document}");
  });

  it("handles a fragment with no \\begin{document}", () => {
    const { chunks, output } = cleanLatexInChunks("\\section{A}\n{\\bf x}");
    expect(chunks.every((c) => c.kind !== "preamble")).toBe(true);
    expect(output).toContain("\\textbf{x}");
  });

  it("leaves the bibliography untouched", () => {
    const withBib = doc.replace(
      "\\end{document}",
      "\\begin{thebibliography}{9}\n\\bibitem{a} \\textit{Title} \\bigskip\n\\end{thebibliography}",
    );
    expect(cleanLatexInChunks(withBib).output).toContain(
      "\\textit{Title} \\bigskip",
    );
  });
});

describe("mergeChunksAtLevel", () => {
  const chunksFor = () => cleanLatexInChunks(doc).chunks;

  it("level 0 collapses the whole body into one entry", () => {
    const merged = mergeChunksAtLevel(chunksFor(), 0);
    expect(merged).toHaveLength(2);
    expect(merged[0].kind).toBe("preamble");
    expect(merged[1].after).toContain("Alpha");
    expect(merged[1].after).toContain("Two");
  });

  it("level 1 gives one entry per top-level division", () => {
    const merged = mergeChunksAtLevel(chunksFor(), 1);
    expect(
      merged.filter((c) => c.kind === "division").map((c) => c.title),
    ).toEqual(["One", "Two"]);
  });

  it("level 1 folds a chapter's sections into the chapter", () => {
    const merged = mergeChunksAtLevel(chunksFor(), 1);
    const one = merged.find((c) => c.title === "One")!;
    expect(one.after).toContain("Alpha");
    expect(one.after).toContain("Beta");
    expect(one.after).not.toContain("Two");
  });

  it("level 2 keeps sections as their own entries", () => {
    const merged = mergeChunksAtLevel(chunksFor(), 2);
    expect(
      merged.filter((c) => c.kind === "division").map((c) => c.title),
    ).toEqual(["One", "Alpha", "Beta", "Two"]);
  });

  it("carries every fix through unchanged at any level", () => {
    const all = chunksFor().flatMap((c) => c.fixes).length;
    for (const level of [0, 1, 2, 3]) {
      const merged = mergeChunksAtLevel(chunksFor(), level);
      expect(merged.flatMap((c) => c.fixes)).toHaveLength(all);
    }
  });

  it("always keeps the preamble separate", () => {
    for (const level of [0, 1, 2]) {
      expect(mergeChunksAtLevel(chunksFor(), level)[0].kind).toBe("preamble");
    }
  });
});
