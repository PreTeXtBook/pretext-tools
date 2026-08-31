import { describe, expect, it } from "vitest";
import { dedupeXmlIds } from "./dedupe-ids";

// The naming policy (`pickReplacementId`) is deliberately not pinned here:
// these specs assert the properties a rename must have, so the policy can
// change without rewriting the suite.

describe("dedupeXmlIds: what stays put", () => {
  it("leaves a fragment whose ids are all free exactly as written", () => {
    const source = `<section xml:id="hw3"><theorem xml:id="thm-a"><p>P.</p></theorem></section>`;
    const result = dedupeXmlIds(source, {
      takenIds: new Set(["sec-intro", "thm-pythagoras"]),
    });
    expect(result.source).toBe(source);
    expect(result.renamed).toEqual([]);
  });

  it("leaves ids alone when the host project is empty", () => {
    const source = `<section xml:id="a"><p xml:id="b">Text.</p></section>`;
    const result = dedupeXmlIds(source, { takenIds: new Set() });
    expect(result.source).toBe(source);
  });
});

describe("dedupeXmlIds: collisions with the host", () => {
  it("renames an id the host already uses", () => {
    const taken = new Set(["sec-intro"]);
    const result = dedupeXmlIds(
      `<section xml:id="sec-intro"><p>P.</p></section>`,
      {
        takenIds: taken,
      },
    );
    expect(result.renamed).toHaveLength(1);
    expect(result.renamed[0].from).toBe("sec-intro");
    expect(taken.has(result.renamed[0].to)).toBe(false);
    expect(result.source).toContain(`xml:id="${result.renamed[0].to}"`);
    expect(result.source).not.toContain(`xml:id="sec-intro"`);
  });

  it("renames ids at any depth, not just the fragment root", () => {
    const result = dedupeXmlIds(
      `<section xml:id="a"><theorem xml:id="thm-1"><p>P.</p></theorem></section>`,
      { takenIds: new Set(["thm-1"]) },
    );
    expect(result.renamed.map((r) => r.from)).toEqual(["thm-1"]);
    expect(result.source).toContain(`<section xml:id="a">`);
  });

  it("never hands two collisions the same new name", () => {
    const result = dedupeXmlIds(
      `<section xml:id="a"><p xml:id="a-2">One.</p><p xml:id="b">Two.</p></section>`,
      { takenIds: new Set(["a", "b"]) },
    );
    const names = [...result.source.matchAll(/xml:id="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(["a", "b"]).not.toContain(name);
    }
  });

  it("renames an id that is not a valid ref even when nothing collides", () => {
    const result = dedupeXmlIds(
      `<section xml:id="3 bad id"><p>P.</p></section>`,
      {
        takenIds: new Set(),
      },
    );
    expect(result.renamed).toHaveLength(1);
    expect(result.renamed[0].to).toMatch(/^[a-zA-Z_][a-zA-Z0-9\-_]*$/);
  });
});

describe("dedupeXmlIds: references follow their target", () => {
  it("rewrites an internal xref pointing at a renamed id", () => {
    const result = dedupeXmlIds(
      `<section xml:id="sec-intro"><p>See <xref ref="sec-intro"/>.</p></section>`,
      { takenIds: new Set(["sec-intro"]) },
    );
    const renamedTo = result.renamed[0].to;
    expect(result.source).toContain(`<xref ref="${renamedTo}"/>`);
    expect(result.source).not.toContain(`ref="sec-intro"`);
  });

  it("leaves an xref pointing outside the fragment alone", () => {
    const result = dedupeXmlIds(
      `<section xml:id="sec-intro"><p>See <xref ref="ch-background"/>.</p></section>`,
      { takenIds: new Set(["sec-intro", "ch-background"]) },
    );
    expect(result.source).toContain(`<xref ref="ch-background"/>`);
  });

  it("rewrites each name of a multi-target xref", () => {
    const result = dedupeXmlIds(
      `<section xml:id="a"><theorem xml:id="b"><p>P.</p></theorem><p>See <xref ref="a b"/>.</p></section>`,
      { takenIds: new Set(["a", "b"]) },
    );
    const [a, b] = result.renamed.map((r) => r.to);
    expect(result.source).toContain(`<xref ref="${a} ${b}"/>`);
  });

  it("rewrites the endpoints of an xref range", () => {
    const result = dedupeXmlIds(
      `<section><p xml:id="p1">One.</p><p xml:id="p2">Two.</p><p><xref first="p1" last="p2"/></p></section>`,
      { takenIds: new Set(["p1", "p2"]) },
    );
    const [p1, p2] = result.renamed.map((r) => r.to);
    expect(result.source).toContain(`<xref first="${p1}" last="${p2}"/>`);
  });

  // Placeholders address divisions by the same name an `xml:id` declares, so
  // they follow a rename — but only when the declaration is in the fragment
  // too. Hence the whole-fragment, pre-split contract (see the module docs).
  it("rewrites division placeholders whose target is declared in the fragment", () => {
    const result = dedupeXmlIds(
      `<section xml:id="sec-a"><plus:subsection ref="sub-a"/><subsection xml:id="sub-a"><p>P.</p></subsection></section>`,
      { takenIds: new Set(["sub-a"]) },
    );
    const renamedTo = result.renamed[0].to;
    expect(result.source).toContain(`<plus:subsection ref="${renamedTo}"/>`);
    expect(result.source).toContain(`<subsection xml:id="${renamedTo}">`);
  });

  it("preserves single-quoted attribute values", () => {
    const result = dedupeXmlIds(
      `<section xml:id='sec-intro'><p>See <xref ref='sec-intro'/>.</p></section>`,
      { takenIds: new Set(["sec-intro"]) },
    );
    const renamedTo = result.renamed[0].to;
    expect(result.source).toContain(`xml:id='${renamedTo}'`);
    expect(result.source).toContain(`ref='${renamedTo}'`);
  });
});
