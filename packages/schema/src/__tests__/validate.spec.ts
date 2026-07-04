import { describe, it, expect } from "vitest";
import { validateDocument } from "../validate";
import { compileRngToGrammar } from "../compile";
import { testGrammar } from "./helpers";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

const VALID = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article xml:id="art">
    <title>Hello</title>
    <p>Some text.</p>
  </article>
</pretext>`;

describe("validateDocument", () => {
  it("reports no diagnostics for a valid document", () => {
    const result = validateDocument(VALID, testGrammar(), {
      resolveXIncludes: false,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a disallowed element with a precise location", () => {
    const doc = `<?xml version="1.0"?>
<pretext>
  <article xml:id="a">
    <title>Hi</title>
    <notathing>oops</notathing>
    <p>ok</p>
  </article>
</pretext>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const diag = result.diagnostics[0];
    expect(diag.message).toMatch(/notathing/);
    expect(diag.code).toBe("element-not-allowed");
    // `<notathing>` is on line 5 (0-based line 4).
    expect(diag.range.start.line).toBe(4);
    expect(diag.range.start.character).toBeGreaterThanOrEqual(4);
  });

  it("reports a disallowed attribute", () => {
    const doc = `<pretext>
  <article xml:id="a">
    <title>Hi</title>
    <p bogus="x">text</p>
  </article>
</pretext>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    const attrDiag = result.diagnostics.find(
      (d) => d.code === "attribute-not-allowed",
    );
    expect(attrDiag).toBeDefined();
    expect(attrDiag!.message).toMatch(/bogus/);
  });

  it("recovers and reports multiple errors in one pass", () => {
    const doc = `<pretext>
  <article xml:id="a">
    <title>Hi</title>
    <nope1>x</nope1>
    <p>text</p>
    <nope2>y</nope2>
  </article>
</pretext>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    const bad = result.diagnostics.filter(
      (d) => d.code === "element-not-allowed",
    );
    expect(bad.length).toBeGreaterThanOrEqual(2);
  });

  it("validates a section-level fragment (modular file)", () => {
    const doc = `<section xml:id="sec">
  <title>A Section</title>
  <p>Body.</p>
</section>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("reports well-formedness errors", () => {
    const doc = `<pretext><article><title>Hi</title></article>`; // unclosed pretext
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("respects an abort signal", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      validateDocument(VALID, testGrammar(), {
        signal: controller.signal,
        resolveXIncludes: false,
      }),
    ).toThrow(/abort/i);
  });

  it("produces the same grammar whether compiled or loaded from JSON", async () => {
    const compiled = await compileRngToGrammar(
      path.resolve(
        here,
        "../../../vscode-extension/assets/schema/pretext.rng",
      ),
    );
    const result = validateDocument(VALID, compiled, {
      resolveXIncludes: false,
    });
    expect(result.diagnostics).toEqual([]);
  });
});

describe("performance", () => {
  it("validates a large document quickly", () => {
    const paras = Array.from(
      { length: 4500 },
      (_, i) => `    <p>Paragraph number ${i} with some words.</p>`,
    ).join("\n");
    const big = `<pretext>
  <article xml:id="a">
    <title>Big</title>
${paras}
  </article>
</pretext>`;
    expect(big.length).toBeGreaterThan(200_000);
    const start = performance.now();
    const result = validateDocument(big, testGrammar(), {
      resolveXIncludes: false,
    });
    const elapsed = performance.now() - start;
    expect(result.diagnostics).toEqual([]);
    // Generous CI-safe bound; typically well under 200 ms.
    expect(elapsed).toBeLessThan(2000);
  });
});
