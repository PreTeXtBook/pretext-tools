import { describe, it, expect } from "vitest";
import { getCompletions } from "../completions";
import { testGrammar } from "./helpers";
import type { Position } from "../types";

function complete(text: string, position: Position) {
  return getCompletions({ text, position, grammar: testGrammar() }).map(
    (c) => c.label,
  );
}

describe("getCompletions", () => {
  it("offers child elements inside an element's content", () => {
    // Cursor after the <p> line, inside <article>.
    const text = `<pretext>
  <article xml:id="a">
    <title>Hi</title>
    <p>text</p>

  </article>
</pretext>`;
    const labels = complete(text, { line: 4, character: 4 });
    expect(labels).toContain("p");
  });

  it("filters element completions by the partially-typed name", () => {
    const text = `<pretext>
  <article xml:id="a">
    <title>Hi</title>
    <p>text</p>
    <p
  </article>
</pretext>`;
    const labels = complete(text, { line: 4, character: 6 });
    expect(labels).toContain("p");
    expect(labels.every((l) => l.startsWith("p"))).toBe(true);
  });

  it("de-duplicates repeated possibilities", () => {
    const text = `<pretext>
  <article xml:id="a">
    <`;
    const labels = complete(text, { line: 2, character: 5 });
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("offers attribute names inside a start tag", () => {
    const text = `<pretext>
  <article `;
    const labels = complete(text, { line: 1, character: 11 });
    expect(labels).toContain("xml:id");
  });

  it("excludes already-present attributes", () => {
    const text = `<pretext>
  <article xml:id="a" `;
    const labels = complete(text, { line: 1, character: 22 });
    expect(labels).not.toContain("xml:id");
  });

  it("returns nothing inside an attribute value", () => {
    const text = `<pretext>
  <article xml:id="`;
    const labels = complete(text, { line: 1, character: 19 });
    expect(labels).toEqual([]);
  });
});
