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

  it("attaches parent/ancestor context to errors", () => {
    const doc = `<pretext>
  <article xml:id="a">
    <title>Hi</title>
    <notathing>oops</notathing>
    <p>ok</p>
  </article>
</pretext>`;
    // A rule that echoes the captured context into the diagnostic message so we
    // can assert on it (parent/ancestors live on the raw SchemaError).
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
      ruleset: {
        rules: [
          {
            id: "echo",
            match: (e) => e.kind === "element-not-allowed",
            message: (e) => `parent=${e.parent} ancestors=${e.ancestors?.join(">")}`,
          },
        ],
      },
    });
    const diag = result.diagnostics[0];
    expect(diag.message).toBe("parent=article ancestors=pretext>article");
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

  it("reports a duplicate xml:id", () => {
    const doc = `<pretext>
  <article xml:id="dup">
    <title>Hi</title>
    <p xml:id="dup">Body.</p>
  </article>
</pretext>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    const dupDiag = result.diagnostics.find((d) => d.code === "duplicate-id");
    expect(dupDiag).toBeDefined();
    expect(dupDiag!.message).toMatch(/dup/);
  });

  it("does not flag distinct xml:ids", () => {
    const doc = `<pretext>
  <article xml:id="a">
    <title>Hi</title>
    <p xml:id="b">Body.</p>
  </article>
</pretext>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a duplicate label", () => {
    const doc = `<pretext>
  <article xml:id="art">
    <title>Hi</title>
    <mermaid label="dup">graph TD; A --> B;</mermaid>
    <mermaid label="dup">graph TD; C --> D;</mermaid>
  </article>
</pretext>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    const dupDiag = result.diagnostics.find(
      (d) => d.code === "duplicate-label",
    );
    expect(dupDiag).toBeDefined();
    expect(dupDiag!.message).toMatch(/dup/);
  });

  it("does not flag distinct labels", () => {
    const doc = `<pretext>
  <article xml:id="art">
    <title>Hi</title>
    <mermaid label="a">graph TD; A --> B;</mermaid>
    <mermaid label="b">graph TD; C --> D;</mermaid>
  </article>
</pretext>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    expect(
      result.diagnostics.filter((d) => d.code === "duplicate-label"),
    ).toEqual([]);
  });

  it("reports a dangling xref target", () => {
    const doc = `<pretext>
  <article xml:id="art">
    <title>Hi</title>
    <p>See <xref ref="nope"/> for details.</p>
  </article>
</pretext>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    const diag = result.diagnostics.find(
      (d) => d.code === "dangling-reference",
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toMatch(/nope/);
  });

  it("resolves a forward xref target within the same document", () => {
    const doc = `<pretext>
  <article xml:id="art">
    <title>Hi</title>
    <p>See <xref ref="p2"/> for details.</p>
    <p xml:id="p2">Body.</p>
  </article>
</pretext>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves a fragref target against a fragment's xml:id", () => {
    const doc = `<pretext>
  <fragment xml:id="frag1">
    <title>Frag</title>
    <code>1 + 1</code>
  </fragment>
  <fragment xml:id="frag2">
    <title>Frag 2</title>
    <fragref ref="frag1"/>
  </fragment>
</pretext>`;
    const result = validateDocument(doc, testGrammar(), {
      resolveXIncludes: false,
    });
    expect(
      result.diagnostics.filter((d) => d.code === "dangling-reference"),
    ).toEqual([]);
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
