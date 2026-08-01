// A PreTeXt project mixes three unrelated XML vocabularies across files that
// all end in `.ptx`: the manifest, the publication file, and the source
// documents. These tests pin down that each compiled grammar accepts its own
// vocabulary and rejects the others — the property that makes selecting a
// grammar per file worth doing at all.

import { describe, it, expect } from "vitest";
import { validateDocument } from "../validate";
import { projectGrammar, publicationGrammar, testGrammar } from "./helpers";
import type { Grammar } from "../types";

/** Validate without touching the filesystem for xi:includes. */
function check(source: string, grammar: Grammar) {
  return validateDocument(source, grammar, {
    uri: "file:///book/sample.ptx",
    resolveXIncludes: false,
  }).diagnostics;
}

const MANIFEST = `<project ptx-version="2">
  <targets>
    <target name="web" format="html"/>
  </targets>
</project>`;

const PUBLICATION = `<publication>
  <common/>
  <html>
    <baseurl href="https://example.com"/>
  </html>
</publication>`;

const SOURCE = `<pretext>
  <article xml:id="a">
    <title>T</title>
    <p>Body.</p>
  </article>
</pretext>`;

describe("project.ptx manifest grammar", () => {
  it("accepts a valid v2 manifest", () => {
    expect(check(MANIFEST, projectGrammar())).toEqual([]);
  });

  it("rejects an element the manifest schema does not define", () => {
    const bad = `<project ptx-version="2">
  <targets>
    <target name="web" format="html"/>
  </targets>
  <nonsense/>
</project>`;
    const diagnostics = check(bad, projectGrammar());
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostics)).toContain("nonsense");
  });

  it("rejects an invalid target format", () => {
    const bad = `<project ptx-version="2">
  <targets>
    <target name="web" format="not-a-format"/>
  </targets>
</project>`;
    expect(check(bad, projectGrammar()).length).toBeGreaterThan(0);
  });
});

describe("publication grammar", () => {
  it("accepts a valid publication file", () => {
    expect(check(PUBLICATION, publicationGrammar())).toEqual([]);
  });

  it("rejects an element the publication schema does not define", () => {
    const bad = `<publication>
  <common/>
  <nonsense/>
</publication>`;
    const diagnostics = check(bad, publicationGrammar());
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostics)).toContain("nonsense");
  });
});

// The regression this whole change is about: before per-kind selection, these
// files were either validated against PreTeXt's grammar (every element wrong)
// or skipped outright. Each grammar must reject the other kinds' roots.
describe("grammars do not accept each other's documents", () => {
  const cases: Array<[string, string, () => Grammar]> = [
    ["a manifest", MANIFEST, testGrammar],
    ["a publication file", PUBLICATION, testGrammar],
    ["a source document", SOURCE, projectGrammar],
    ["a publication file", PUBLICATION, projectGrammar],
    ["a source document", SOURCE, publicationGrammar],
    ["a manifest", MANIFEST, publicationGrammar],
  ];

  for (const [what, source, grammar] of cases) {
    it(`flags ${what} under the wrong grammar`, () => {
      expect(check(source, grammar()).length).toBeGreaterThan(0);
    });
  }

  it("accepts each document under its own grammar", () => {
    expect(check(SOURCE, testGrammar())).toEqual([]);
    expect(check(MANIFEST, projectGrammar())).toEqual([]);
    expect(check(PUBLICATION, publicationGrammar())).toEqual([]);
  });
});
