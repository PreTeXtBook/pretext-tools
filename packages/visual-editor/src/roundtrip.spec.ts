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
import {
  checkRoundTrip,
  parsePtx,
  roundTripPtx,
  serializeEditorJson,
} from "./roundtrip";
import { editorSourceTags } from "./editorExtensions";
import { KNOWN_TAGS } from "./knownTags";

/**
 * Assert that a PreTeXt string survives the editor round-trip unchanged
 * (modulo formatting). On failure vitest shows a diff of
 * expected-vs-actual formatted XML, which pinpoints the lost construct.
 */
function expectLossless(ptx: string) {
  expect(roundTripPtx(ptx)).toBe(formatPretext(ptx));
}

// ─── Schema contract ─────────────────────────────────────────────────────────

describe("KNOWN_TAGS ↔ schema contract", () => {
  it("KNOWN_TAGS matches exactly the tags the editor schema can represent", () => {
    // KNOWN_TAGS (knownTags.ts) is the static list cleanPtx uses to decide
    // what to pass through to the parser; editorSourceTags is derived from
    // the REAL schema in editorExtensions.ts. They must be identical:
    //  - a tag in KNOWN_TAGS without a schema node gets DESTROYED by the
    //    parser instead of being safely rawptx-wrapped (this shipped four
    //    times: conclusion, part, worksheet, pre);
    //  - a schema node missing from KNOWN_TAGS would be needlessly
    //    rawptx-wrapped and never editable.
    // If this test fails you added/removed an extension or a KNOWN_TAGS
    // entry without updating the other side.
    expect(new Set(KNOWN_TAGS)).toEqual(editorSourceTags);
  });
});

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

  it("keeps an empty paragraph", () => {
    // Empty paragraphs appear both in authored sources and — much more
    // importantly — every time a user presses Enter in the editor (the
    // split leaves a new, still-empty <p> that gets saved before they
    // type). json2ptx serializes childless element nodes as empty
    // elements; formatPretext canonicalizes them to <p/> on both sides of
    // the comparison. See also the "editing session" test below, which
    // simulates the Enter key directly.
    expectLossless(`<section>
  <title>Drafting</title>
  <p>Finished thought.</p>
  <p></p>
</section>`);
  });
});

// ─── Editing-session behavior ────────────────────────────────────────────────
//
// The green fixtures above all test parse→serialize of untouched documents.
// This section simulates actual EDITS to the parsed JSON (the way TipTap
// mutates the document) and asserts that what would be saved still passes
// the guard — i.e. the editor does not disable itself in response to its
// own ordinary editing operations.

describe("round-trip: mid-edit states stay safe", () => {
  it("pressing Enter (a new empty paragraph) saves as <p/> and keeps editing enabled", () => {
    // Reproduces the real bug: hitting return in a paragraph splits it,
    // leaving an empty p node. ProseMirror's toJSON() omits the content key
    // for childless nodes, and json2ptx used to fall through to a
    // "Something is missing" XML comment for them — which then failed the
    // guard's echo re-verification (comments don't round-trip) and locked
    // the editor mid-session.
    const { json, xmlDecl } = parsePtx(`<section>
  <title>Typing</title>
  <p>First thought.</p>
</section>`);

    // Simulate the Enter key: append an empty paragraph node (exactly what
    // editor.getJSON() reports after a splitBlock) inside the section.
    type MutableNode = { type: string; content?: MutableNode[] };
    const doc = json as unknown as MutableNode;
    const section = doc.content![0].content![0];
    section.content!.push({ type: "p" });

    const saved = serializeEditorJson(json, xmlDecl);
    // The empty paragraph lands in the source as well-formed XML...
    expect(saved).toContain("<p/>");
    expect(saved).not.toContain("<!--");
    // ...and the saved document itself passes the guard, so the editing
    // session survives the save/echo cycle while the author keeps typing.
    expect(checkRoundTrip(saved).safe).toBe(true);
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
    // href is captured by the generic PtxSourceAttributes mechanism and
    // spread back onto the rendered <a> so the link works in the editor.
    expectLossless(
      `<p>Visit <url href="https://pretextbook.org">the PreTeXt site</url> for more.</p>`,
    );
  });
});

// ─── Marks spanning multiple inline nodes ────────────────────────────────────
//
// json2ptx serializes marks with a run-merging stack (see processChildren):
// a mark covering several siblings — text, chips, math — emits ONE pair of
// tags, and nested marks that follow the canonical rank order (em, alert,
// term, c — set in Inline.ts) reproduce their nesting. The first two
// fixtures were promoted from roundtrip.gaps.spec.ts when mark-run merging
// landed (2026-07-19). Reverse-order nesting (e.g. <term><em>…</em></term>)
// cannot be recorded by ProseMirror and remains documented in the gaps
// suite.

describe("round-trip: marks spanning multiple inline nodes", () => {
  it("keeps a mark that covers text and an unknown-inline chip", () => {
    // Promoted from gaps: the em used to split around the chip —
    // <em>See </em><xref/><em> please.</em>
    expectLossless(`<p><em>See <xref ref="thm-1"/> please.</em></p>`);
  });

  it("keeps nested marks in canonical order (term inside em)", () => {
    // Promoted from gaps (was: "nested/overlapping marks lose all but the
    // first mark") — the old serializer emitted only the first mark of a
    // multi-mark text node.
    expectLossless(`<p><em>All <term>nested</term> emphasis</em> here.</p>`);
  });

  it("keeps inline code nested inside other marks (c is innermost)", () => {
    expectLossless(
      `<p>Try <em>the <c>seq()</c> function</em> or <term>the <c>map</c> idiom</term>.</p>`,
    );
  });

  it("keeps a mark that covers text and inline math", () => {
    expectLossless(`<p><em>note that <m>x^2</m> grows</em> quickly.</p>`);
  });

  it("keeps adjacent, differently-marked runs", () => {
    // Exercises the stack's close-then-open transition between siblings
    // whose mark sets share no prefix.
    expectLossless(
      `<p><em>fast</em><term>graph</term> and <alert>stop</alert><c>now</c></p>`,
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
    // Attributes are captured generically by PtxSourceAttributes
    // (editorExtensions.ts); see the dedicated "attribute preservation"
    // section below for broader coverage.
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

// ─── Attribute preservation ──────────────────────────────────────────────────
//
// Every element-backed node carries a catch-all `ptxAttrs` record (the
// PtxSourceAttributes extension in editorExtensions.ts) that captures ALL
// source attributes in document order; json2ptx expands them back,
// XML-escaped. The first four fixtures were promoted from
// roundtrip.gaps.spec.ts when the mechanism landed (2026-07-19) — before
// that, divisions and paragraphs silently dropped xml:id, breaking every
// xref that targeted them.

describe("round-trip: attribute preservation", () => {
  it("keeps xml:id on <section>", () => {
    expectLossless(`<section xml:id="sec-important">
  <title>Anchored</title>
  <p>Other files point at this section.</p>
</section>`);
  });

  it("keeps xml:id on <chapter>", () => {
    expectLossless(`<chapter xml:id="ch-one">
  <title>One</title>
  <p>Text.</p>
</chapter>`);
  });

  it("keeps xml:id on <p>", () => {
    expectLossless(`<p xml:id="p-key-idea">The key idea.</p>`);
  });

  it("escapes & in attribute values", () => {
    // The DOM stores attribute values DECODED, so the serializer must
    // re-escape them; this used to produce malformed XML.
    expectLossless(
      `<p><url href="https://example.com/?a=1&amp;b=2">link</url></p>`,
    );
  });

  it("keeps multiple attributes in source order", () => {
    expectLossless(`<theorem xml:id="thm-main" label="thm-main-label" component="web">
  <statement>
    <p>Order matters for a byte-identical round-trip.</p>
  </statement>
</theorem>`);
  });

  it("keeps attributes on list elements", () => {
    // <ol marker="a."> exercises attributes on the TipTap-native list
    // nodes (bulletList/orderedList/listItem), which have no PreTeXt
    // extension file of their own.
    expectLossless(`<ol marker="a.">
  <li xml:id="item-first">
    <p>First.</p>
  </li>
</ol>`);
  });

  it("keeps permid on paragraphs and divisions", () => {
    // permid is added by pretext-cli to banked sources; losing it would
    // churn every diff.
    expectLossless(`<section permid="abcd">
  <title>Banked</title>
  <p permid="efgh">Tracked paragraph.</p>
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

// ─── Inline rawptx chips ─────────────────────────────────────────────────────
//
// Unknown elements inside a paragraph's text flow cannot use the block
// <rawptx> wrapper (illegal in `inline*` content), so cleanPtx wraps them in
// <rawptx-inline> — rendered as a small editable chip showing the raw
// source — and json2ptx emits the chip text verbatim. The first three
// fixtures here were promoted from roundtrip.gaps.spec.ts when the
// mechanism landed (2026-07-19).
//
// Known boundary: a chip INSIDE a marked span (<em>… <xref/> …</em>) still
// splits the mark on output; that remains documented in the gaps suite.

describe("round-trip: inline rawptx chips for unknown inline elements", () => {
  it("keeps <xref> inside a paragraph", () => {
    // The single most common inline element in real PreTeXt — previously
    // the block wrapper was rejected by the paragraph and the xref was
    // destroyed.
    expectLossless(`<section>
  <title>References</title>
  <p>See <xref ref="thm-pythagoras"/> for the proof.</p>
</section>`);
  });

  it("keeps <fn> (footnote) inside a paragraph", () => {
    expectLossless(`<p>A bold claim.<fn>Citation needed.</fn></p>`);
  });

  it("keeps several unknown inline elements in one paragraph", () => {
    expectLossless(
      `<p>As <xref ref="lem-2"/> shows, a <q>graph</q> from <init>GT</init> works.</p>`,
    );
  });

  it("keeps unknown inline elements at the start and end of a paragraph", () => {
    // Edge positions exercise ProseMirror's whitespace handling around
    // inline nodes at text-flow boundaries.
    expectLossless(
      `<p><xref ref="a"/> opens, and it closes with <xref ref="b"/></p>`,
    );
  });

  it("keeps <md> with <mrow> children as a verbatim chip", () => {
    // Promoted from gaps: md's editor content model is text*, which cannot
    // hold mrow elements — the rows used to be corrupted into escaped text.
    // cleanPtx now escalates: a math element containing element children is
    // preserved WHOLE as an inline chip (see TEXT_ONLY_MATH_TAGS in
    // utils.ts). It loses KaTeX rendering until <mrow> is modeled, but it
    // round-trips losslessly.
    expectLossless(`<p>Align:
  <md>
    <mrow>a \\amp= b</mrow>
    <mrow>c \\amp= d</mrow>
  </md>
</p>`);
  });

  it("keeps an unknown block element inside <statement>", () => {
    // The block <rawptx> node is now a member of the BasicBlock/block
    // groups (extensions/RawPtx.ts), so wrapped unknown blocks are legal
    // everywhere ordinary blocks go — statement, proof, hint, list items —
    // not just at division level.
    expectLossless(`<theorem>
  <statement>
    <p>Consider the following table.</p>
    <tabular>
      <row>
        <cell>x</cell>
      </row>
    </tabular>
  </statement>
</theorem>`);
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

  it("passes unmodeled divisions (conclusion, worksheet, part) through verbatim", () => {
    // Promoted from gaps: these are real PreTeXt divisions with no schema
    // node yet. They used to be listed in KNOWN_TAGS anyway — so cleanPtx
    // skipped the safety wrapper and the parser destroyed them. Now that
    // KNOWN_TAGS is held equal to the schema (see the contract test at the
    // top of this file), they travel via rawptx: not editable as rich
    // blocks, but perfectly preserved.
    expectLossless(`<section>
  <title>End</title>
  <p>Body.</p>
  <conclusion>
    <p>Wrapping up.</p>
  </conclusion>
</section>`);
    expectLossless(`<worksheet>
  <title>Practice</title>
  <p>Do these problems.</p>
</worksheet>`);
    expectLossless(`<part>
  <title>Part One</title>
  <chapter>
    <title>Beginnings</title>
    <p>Text.</p>
  </chapter>
</part>`);
  });

  it("passes <pre> through verbatim, preserving interior whitespace", () => {
    // Promoted from gaps: TipTap's CodeBlock extension used to claim <pre>
    // and re-emit it as <codeBlock>. CodeBlock is no longer registered
    // (see editorExtensions.ts), so <pre> takes the rawptx route like any
    // other unmodeled verbatim element.
    expectLossless(`<section>
  <title>Code</title>
  <pre>x = 1
y = 2</pre>
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

// ─── Comments ────────────────────────────────────────────────────────────────
//
// XML comments have no editor node, and TipTap's HTML parser silently drops
// comment DOM nodes — so cleanPtx wraps them as raw source (block rawptx
// between blocks, an inline chip inside paragraph flow), exactly like
// unknown elements. Promoted from roundtrip.gaps.spec.ts (2026-07-19).
// CDATA sections and processing instructions ride the same path.

describe("round-trip: XML comments survive as raw source", () => {
  it("keeps a comment between blocks", () => {
    expectLossless(`<section>
  <title>Notes</title>
  <!-- TODO: rewrite this paragraph -->
  <p>Draft text.</p>
</section>`);
  });

  it("keeps a comment inside a paragraph", () => {
    expectLossless(`<p>Keep this text <!-- and this note --> together.</p>`);
  });

  it("keeps a top-level comment before the root division", () => {
    // The license/copyright header comment that starts many PreTeXt files.
    expectLossless(`<?xml version="1.0" encoding="UTF-8"?>
<!-- Copyright 2026 Oscar Levin -->
<section>
  <title>Body</title>
  <p>Text.</p>
</section>`);
  });

  it("keeps a comment inside inline math by preserving the whole <m> verbatim", () => {
    // A non-text child inside m/me/md triggers the math escalation rule in
    // cleanPtx: the whole element becomes a chip rather than losing the
    // comment.
    expectLossless(`<p>Consider <m>x^2 <!-- squared! --></m> here.</p>`);
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
    // Attributes on MARK elements are still dropped (see
    // roundtrip.gaps.spec.ts), so the guard must refuse to enable editing.
    // (This fixture has been updated twice as earlier lossy constructs —
    // xml:id on divisions, then XML comments — became lossless. If mark
    // attributes get fixed, pick the next fixture from the gaps suite.)
    const report = checkRoundTrip(`<section>
  <title>Refuse me</title>
  <p><em permid="mark-id">Editing</em> must stay disabled.</p>
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
