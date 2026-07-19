/**
 * Round-trip test harness for the visual editor — the "green" suite.
 *
 * ── What is being tested ──────────────────────────────────────────────────
 *
 * Every fixture in this file is asserted to survive a full editor round-trip
 * with NO loss:
 *
 *     roundTripPtx(ptx) === formatPretext(ptx)
 *
 * where roundTripPtx = cleanPtx → TipTap parse (the real editor schema from
 * editorExtensions.ts) → json2ptx → formatPretext. Both sides pass through
 * the same formatter, so the assertion is insensitive to whitespace and
 * indentation but sensitive to ANY dropped/changed element, attribute, or
 * text — exactly the property the runtime guard (checkRoundTrip) enforces
 * before enabling editing.
 *
 * ── How to work with this file ────────────────────────────────────────────
 *
 * - Adding support for a new PreTeXt element? Add a fixture here proving it
 *   round-trips. This suite is the regression net for editor fidelity.
 * - Found a construct that loses data? Add it to roundtrip.gaps.spec.ts
 *   (the expected-failure suite) instead, with a comment explaining the
 *   root cause. When the bug is fixed, vitest will flag the gap test as
 *   "expected to fail, but passed" — at that point move the fixture here.
 *
 * Environment note: these tests need jsdom (TipTap parses via DOMParser);
 * see vitest.config.ts.
 */
import { describe, expect, it } from "vitest";
import { formatPretext } from "@pretextbook/format";
import { checkRoundTrip, parsePtx, roundTripPtx } from "./roundtrip";

/**
 * Assert that a PreTeXt string survives the editor round-trip unchanged
 * (modulo formatting). On failure vitest shows a diff of
 * expected-vs-actual formatted XML, which pinpoints the lost construct.
 */
function expectLossless(ptx: string) {
  expect(roundTripPtx(ptx)).toBe(formatPretext(ptx));
}

// ─── Basic documents ─────────────────────────────────────────────────────────

describe("round-trip: basic documents", () => {
  it("keeps a minimal section file, including the XML declaration", () => {
    // The shape of a typical modular PreTeXt source file: an XML declaration
    // followed by a single division. The declaration is not representable in
    // the editor itself; parsePtx captures it and serializeEditorJson
    // restores it (see xmlDecl in roundtrip.ts).
    expectLossless(`<?xml version="1.0" encoding="UTF-8"?>
<section>
  <title>A First Section</title>
  <p>This is a simple paragraph of text.</p>
  <p>And here is a second paragraph.</p>
</section>`);
  });

  it("keeps a bare fragment with no declaration and no division", () => {
    // cleanPtx wraps everything in <ptxdoc>, so loose block content parses
    // fine without any surrounding division.
    expectLossless(`<p>Just one paragraph, no wrapper at all.</p>`);
  });

  it("keeps a subsection inside a section", () => {
    expectLossless(`<section>
  <title>Outer</title>
  <subsection>
    <title>Inner</title>
    <p>Nested content.</p>
  </subsection>
</section>`);
  });

  it("keeps an introduction with paragraphs", () => {
    expectLossless(`<introduction>
  <p>Welcome to the chapter.</p>
  <p>Here is what we will cover.</p>
</introduction>`);
  });
});

// ─── Inline markup ───────────────────────────────────────────────────────────

describe("round-trip: inline markup", () => {
  it("keeps term, em, alert, and c marks", () => {
    expectLossless(`<section>
  <title>Marks</title>
  <p>A <term>graph</term> is a set of vertices and edges.</p>
  <p>This is <em>really</em> important.</p>
  <p>Do <alert>not</alert> forget this.</p>
  <p>Use the <c>print</c> function.</p>
</section>`);
  });

  it("keeps a url with its href attribute", () => {
    // url is a modeled node whose href attribute is explicitly declared in
    // extensions/Url.ts, so it must survive. (An href containing '&' does
    // NOT survive yet — that is documented in roundtrip.gaps.spec.ts.)
    expectLossless(
      `<p>Visit <url href="https://pretextbook.org">the PreTeXt site</url> for more.</p>`,
    );
  });
});

// ─── Math ────────────────────────────────────────────────────────────────────

describe("round-trip: math", () => {
  it("keeps inline math inside a paragraph", () => {
    expectLossless(`<p>Let <m>x^2 + y^2 = z^2</m> be given.</p>`);
  });

  it("keeps a simple me equation inside a paragraph", () => {
    expectLossless(
      `<p>We compute <me>e^{i\\pi} + 1 = 0</me> which is famous.</p>`,
    );
  });
});

// ─── Blocks (theorem-like, definition-like, example-like, remark-like) ──────

describe("round-trip: PreTeXt blocks", () => {
  it("keeps a theorem with title, statement, and proof", () => {
    expectLossless(`<section>
  <title>Results</title>
  <theorem>
    <title>Pythagoras</title>
    <statement>
      <p>In a right triangle, <m>a^2 + b^2 = c^2</m>.</p>
    </statement>
    <proof>
      <p>Left as an exercise.</p>
    </proof>
  </theorem>
</section>`);
  });

  it("keeps xml:id on theorem-like blocks", () => {
    // Theorem-like nodes declare label/xml:id/component in blockAttributes()
    // (utils.ts), so ids survive here. Divisions do NOT declare them yet —
    // that loss is documented in roundtrip.gaps.spec.ts.
    expectLossless(`<theorem xml:id="thm-pythagoras">
  <statement>
    <p>A well known result.</p>
  </statement>
</theorem>`);
  });

  it("keeps a definition", () => {
    expectLossless(`<definition>
  <title>Prime</title>
  <statement>
    <p>An integer greater than one with no nontrivial divisors.</p>
  </statement>
</definition>`);
  });

  it("keeps an example with statement, hint, answer, and solution", () => {
    expectLossless(`<example>
  <title>Counting</title>
  <statement>
    <p>How many subsets does a three element set have?</p>
  </statement>
  <hint>
    <p>Try listing them.</p>
  </hint>
  <answer>
    <p>Eight.</p>
  </answer>
  <solution>
    <p>Each element is in or out, so <m>2^3 = 8</m>.</p>
  </solution>
</example>`);
  });

  it("keeps remark-like and axiom-like blocks", () => {
    expectLossless(`<section>
  <title>Notes</title>
  <remark>
    <p>This convention differs between textbooks.</p>
  </remark>
  <axiom>
    <statement>
      <p>Through any two points there is exactly one line.</p>
    </statement>
  </axiom>
</section>`);
  });
});

// ─── Lists ───────────────────────────────────────────────────────────────────

describe("round-trip: lists", () => {
  it("keeps bulleted and ordered lists whose items contain paragraphs", () => {
    // Note: list items whose content is bare text (no <p>) get normalized by
    // ProseMirror into <li><p>…</p></li>; that is documented as a gap. Items
    // that already contain <p> — the common authored form — are lossless.
    expectLossless(`<section>
  <title>Lists</title>
  <ul>
    <li>
      <p>First item.</p>
    </li>
    <li>
      <p>Second item.</p>
    </li>
  </ul>
  <ol>
    <li>
      <p>Step one.</p>
    </li>
    <li>
      <p>Step two.</p>
    </li>
  </ol>
</section>`);
  });
});

// ─── The rawptx escape hatch ─────────────────────────────────────────────────

describe("round-trip: rawptx passthrough for unknown tags", () => {
  it("passes an unknown block element through verbatim", () => {
    // <tabular> is not modeled by the editor. cleanPtx wraps it in <rawptx>,
    // the editor shows it as raw source, and json2ptx emits the stored text
    // unchanged — so the original markup must survive exactly.
    expectLossless(`<section>
  <title>Data</title>
  <p>Before the table.</p>
  <tabular>
    <row>
      <cell>a</cell>
      <cell>b</cell>
    </row>
  </tabular>
  <p>After the table.</p>
</section>`);
  });

  it("passes a whole <pretext> document through verbatim", () => {
    // <pretext>/<article> are not in KNOWN_TAGS, so a full (non-modular)
    // document is wrapped in ONE big rawptx at the top level. That degrades
    // the editing experience to a raw-source view, but it is LOSSLESS —
    // which is what this suite cares about. Making full documents actually
    // editable is future coverage work.
    expectLossless(`<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article>
    <title>Demo Document</title>
    <p>This is a demo of the PreTeXt visual editor.</p>
  </article>
</pretext>`);
  });
});

// ─── The runtime guard (checkRoundTrip) ──────────────────────────────────────

describe("checkRoundTrip guard", () => {
  it("reports empty content as trivially safe", () => {
    // The VS Code webview mounts with "" before the document arrives; the
    // guard must not flag that state.
    expect(checkRoundTrip("").safe).toBe(true);
    expect(checkRoundTrip("   \n  ").safe).toBe(true);
  });

  it("reports a lossless document as safe and returns the parse for reuse", () => {
    const ptx = `<?xml version="1.0" encoding="UTF-8"?>
<section>
  <title>Safe</title>
  <p>Hello.</p>
</section>`;
    const report = checkRoundTrip(ptx);
    expect(report.safe).toBe(true);
    // expected/actual are returned even on success so callers can log or
    // display them; they must agree by definition of safe.
    expect(report.actual).toBe(report.expected);
    // The guard hands back its parse result so VisualEditor can load the
    // editor from the exact JSON that was verified (single parse, no
    // divergence).
    expect(report.parsed).toBeDefined();
    expect((report.parsed!.json as { type?: string }).type).toBe("ptxFragment");
    // The XML declaration is captured for restoration at save time.
    expect(report.parsed!.xmlDecl).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>',
    );
  });

  it("reports malformed XML as unsafe with a parse-failure reason", () => {
    const report = checkRoundTrip("<section><p>unclosed</section>");
    expect(report.safe).toBe(false);
    expect(report.reason).toMatch(/could not be parsed/);
    // No parse result — there is nothing safe to load.
    expect(report.parsed).toBeUndefined();
  });

  it("reports a document with known-lossy constructs as unsafe", () => {
    // xml:id on a division is silently dropped by the editor today (see
    // roundtrip.gaps.spec.ts), so the guard must refuse to enable editing.
    const report = checkRoundTrip(`<section xml:id="sec-important">
  <title>Refuse me</title>
  <p>Editing this must stay disabled.</p>
</section>`);
    expect(report.safe).toBe(false);
    expect(report.reason).toMatch(/cannot\s+yet edit|losing content/);
    // expected/actual are both present so the mismatch can be diffed.
    expect(report.expected).toBeDefined();
    expect(report.actual).toBeDefined();
    expect(report.actual).not.toBe(report.expected);
    // A lossy-but-parseable document still returns the parse, because the
    // component displays it read-only as a preview.
    expect(report.parsed).toBeDefined();
  });

  it("never throws, even on garbage input", () => {
    expect(() => checkRoundTrip("<<<not xml at all")).not.toThrow();
    expect(checkRoundTrip("<<<not xml at all").safe).toBe(false);
  });
});

// ─── Declaration handling ────────────────────────────────────────────────────

describe("XML declaration preservation", () => {
  it("parsePtx captures the declaration; roundTripPtx restores it", () => {
    const ptx = `<?xml version="1.0" encoding="UTF-8"?>
<p>Body.</p>`;
    expect(parsePtx(ptx).xmlDecl).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>',
    );
    // The round-tripped output must start with the declaration followed by
    // the blank line that formatPretext also emits.
    expect(roundTripPtx(ptx)).toMatch(
      /^<\?xml version="1.0" encoding="UTF-8"\?>\n\n/,
    );
  });

  it("does not invent a declaration when the input has none", () => {
    expect(roundTripPtx("<p>No declaration here.</p>")).not.toContain("<?xml");
  });
});
