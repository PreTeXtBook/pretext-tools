import { describe, expect, it } from "vitest";
import {
  importProjectFromFiles,
  relayoutImport,
  resolveImportSplitLevel,
} from "./upload";
import type { ImportedProjectSuccess } from "./types";

const bookTex = [
  "\\documentclass{book}",
  "\\begin{document}",
  "\\chapter{Intro}",
  "opening words",
  "\\section{Why}",
  "because",
  "\\section{How}",
  "like this",
  "\\chapter{Methods}",
  "\\section{Setup}",
  "set it up",
  "\\end{document}",
].join("\n");

function importBook(splitLevel?: number): ImportedProjectSuccess {
  const result = importProjectFromFiles(
    { "main.tex": bookTex },
    { splitLevel },
  );
  if ("pretextError" in result) throw new Error(result.pretextError);
  return result;
}

const sourceFiles = (result: ImportedProjectSuccess) =>
  Object.keys(result.outputFiles)
    .filter((p) => p.endsWith(".ptx") && p.startsWith("source/"))
    .sort();

describe("relayoutImport", () => {
  it("splits deeper without re-running the conversion", () => {
    const atOne = importBook(1);
    const atTwo = relayoutImport(atOne, 2);
    expect(atTwo.pretextSource).toBe(atOne.pretextSource);
    expect(sourceFiles(atTwo).length).toBeGreaterThan(
      sourceFiles(atOne).length,
    );
    expect(sourceFiles(atTwo).some((p) => p.includes("sec-"))).toBe(true);
  });

  it("collapses back to one file at level 0", () => {
    const flattened = relayoutImport(importBook(2), 0);
    expect(sourceFiles(flattened)).toEqual(["source/main.ptx"]);
  });

  it("is round-trippable", () => {
    const atOne = importBook(1);
    const there = relayoutImport(atOne, 2);
    const back = relayoutImport(there, 1);
    expect(sourceFiles(back)).toEqual(sourceFiles(atOne));
  });

  it("returns the same object when the depth has not changed", () => {
    const result = importBook(1);
    expect(relayoutImport(result, 1)).toBe(result);
  });

  it("records the depth it laid out at", () => {
    expect(relayoutImport(importBook(1), 2).splitLevel).toBe(2);
  });

  it("does not regenerate the publication or manifest files", () => {
    const atOne = importBook(1);
    const atTwo = relayoutImport(atOne, 2);
    expect(atTwo.outputFiles["project.ptx"]).toBe(
      atOne.outputFiles["project.ptx"],
    );
    expect(atTwo.outputFiles["publication/publication.ptx"]).toBe(
      atOne.outputFiles["publication/publication.ptx"],
    );
  });

  it("leaves no stale files from the previous depth", () => {
    const deep = relayoutImport(importBook(1), 2);
    const shallow = relayoutImport(deep, 1);
    expect(sourceFiles(shallow).some((p) => p.includes("sec-"))).toBe(false);
  });

  it("re-splits the native pool alongside the converted one", () => {
    const atTwo = relayoutImport(importBook(1), 2);
    expect(atTwo.nativeProject?.divisions.map((d) => d.type)).toContain(
      "section",
    );
  });
});

describe("cleanChunks on the result", () => {
  it("carries one chunk per division regardless of split depth", () => {
    const atOne = importBook(1);
    expect(atOne.cleanChunks.map((c) => c.title)).toEqual([
      "",
      "Intro",
      "Why",
      "How",
      "Methods",
      "Setup",
    ]);
    expect(relayoutImport(atOne, 2).cleanChunks).toEqual(atOne.cleanChunks);
  });
});

describe("resolveImportSplitLevel", () => {
  const latex = {
    format: "latex" as const,
    latexSource: bookTex,
    documentKind: "book" as const,
  };

  it("honours an explicit depth", () => {
    expect(resolveImportSplitLevel({ splitLevel: 3 }, latex)).toBe(3);
  });

  it("clamps a negative depth to zero", () => {
    expect(resolveImportSplitLevel({ splitLevel: -2 }, latex)).toBe(0);
  });

  it("still honours the legacy booleans", () => {
    expect(resolveImportSplitLevel({ splitSections: true }, latex)).toBe(2);
    expect(resolveImportSplitLevel({ splitChapters: false }, latex)).toBe(0);
  });

  it("suggests a depth for LaTeX when nothing was asked for", () => {
    expect(resolveImportSplitLevel({}, latex)).toBe(1);
  });

  it("keeps the historical default for PreTeXt input", () => {
    expect(
      resolveImportSplitLevel({}, { format: "pretext", documentKind: "book" }),
    ).toBe(1);
    expect(
      resolveImportSplitLevel(
        {},
        { format: "pretext", documentKind: "article" },
      ),
    ).toBe(0);
  });
});
