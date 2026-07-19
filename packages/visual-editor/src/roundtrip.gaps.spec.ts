/**
 * Round-trip KNOWN GAPS — the expected-failure suite.
 *
 * Every test in this file documents a construct that the visual editor
 * currently CANNOT round-trip without changing the document. Each test runs
 * the same lossless assertion as roundtrip.spec.ts, but is declared with
 * `it.fails(...)`:
 *
 *   - Today: the round-trip really is lossy, the assertion throws, and
 *     vitest counts the test as PASSING (failure was expected). The suite
 *     stays green while honestly documenting the damage.
 *
 *   - The day someone fixes one of these bugs: the assertion succeeds,
 *     vitest reports the test as FAILING with "expected to fail, but
 *     passed", and the fixer is forced to promote the fixture to the green
 *     suite in roundtrip.spec.ts. Gaps can therefore never silently
 *     "un-document" themselves.
 *
 * IMPORTANT: these are not merely cosmetic differences. Because the runtime
 * guard (checkRoundTrip) compares strictly, every fixture here also
 * represents a document for which the editor will REFUSE to enable editing
 * (safe refusal — the alternative is corrupting the author's source).
 * Fixing entries in this file therefore directly grows the set of
 * real-world documents that are editable.
 *
 * Each test's comment states the ROOT CAUSE and the file where the fix
 * belongs.
 */
import { describe, expect, it } from "vitest";
import { formatPretext } from "@pretextbook/format";
import { roundTripPtx } from "./roundtrip";

/** Same lossless assertion as the green suite (see roundtrip.spec.ts). */
function expectLossless(ptx: string) {
  expect(roundTripPtx(ptx)).toBe(formatPretext(ptx));
}

// ─── KNOWN_TAGS promises tags that have no TipTap node ──────────────────────
//
// knownTags.ts lists these elements, so cleanPtx does NOT wrap them in the
// <rawptx> safety net — but no Node extension is registered for them, so
// ProseMirror's parser drops the tag and lifts its children. The fix is
// either to add real nodes (extensions/) or, better, to derive KNOWN_TAGS
// from the registered schema so the list can never lie again.

describe("gaps: KNOWN_TAGS entries with no schema node (tag is destroyed)", () => {
  it.fails("<conclusion> is dropped", () => {
    expectLossless(`<section>
  <title>End</title>
  <p>Body.</p>
  <conclusion>
    <p>Wrapping up.</p>
  </conclusion>
</section>`);
  });

  it.fails("<worksheet> is dropped", () => {
    expectLossless(`<worksheet>
  <title>Practice</title>
  <p>Do these problems.</p>
</worksheet>`);
  });

  it.fails("<part> is dropped", () => {
    expectLossless(`<part>
  <title>Part One</title>
  <chapter>
    <title>Beginnings</title>
    <p>Text.</p>
  </chapter>
</part>`);
  });

  it.fails(
    "<pre> is mangled (parsed as TipTap codeBlock, emitted as <codeBlock>)",
    () => {
      // Extra wrinkle: <pre> IS a real HTML tag, so TipTap's CodeBlock
      // extension claims it — and json2ptx then serializes the node under its
      // TipTap name "codeBlock", which is not a PreTeXt element at all.
      expectLossless(`<section>
  <title>Code</title>
  <pre>x = 1
y = 2</pre>
</section>`);
    },
  );
});

// ─── Unknown INLINE elements ─────────────────────────────────────────────────
//
// rawptx (extensions/RawPtx.ts) is a block-level node, so when cleanPtx
// wraps an unknown element that sits INSIDE a paragraph, the wrapper is
// illegal in `inline*` content and ProseMirror mangles it. <xref> is the
// single most common inline element in real PreTeXt, so this gap alone
// makes most real-world paragraphs unsafe. Fix: add an inline rawptx node
// (group "inline", rendered as an atom/chip).

describe("gaps: unknown inline elements inside paragraphs", () => {
  it.fails("<xref> inside a paragraph is destroyed", () => {
    expectLossless(`<section>
  <title>References</title>
  <p>See <xref ref="thm-pythagoras"/> for the proof.</p>
</section>`);
  });

  it.fails("<fn> (footnote) inside a paragraph is destroyed", () => {
    expectLossless(`<p>A bold claim.<fn>Citation needed.</fn></p>`);
  });
});

// ─── Attribute loss ──────────────────────────────────────────────────────────
//
// ProseMirror only keeps attributes that a node explicitly declares via
// addAttributes(). Divisions (extensions/Divisions.ts) and Para
// (extensions/Blocks.ts) declare none — so xml:id, permid, label, etc. are
// silently discarded, which breaks every <xref> that targets them. Fix: a
// shared attribute-preservation helper applied to every node (capture ALL
// source attributes), rather than per-node whitelists.

describe("gaps: attributes dropped from nodes that do not declare them", () => {
  it.fails("xml:id on <section> is dropped", () => {
    expectLossless(`<section xml:id="sec-important">
  <title>Anchored</title>
  <p>Other files point at this section.</p>
</section>`);
  });

  it.fails("xml:id on <chapter> is dropped", () => {
    expectLossless(`<chapter xml:id="ch-one">
  <title>One</title>
  <p>Text.</p>
</chapter>`);
  });

  it.fails("xml:id on <p> is dropped", () => {
    expectLossless(`<p xml:id="p-key-idea">The key idea.</p>`);
  });
});

// ─── Structure the content models cannot represent ──────────────────────────
//
// Chapter/Section content expressions in extensions/Divisions.ts use an
// ALTERNATION — `title ((introduction?|section+)|(blocks)+)` — so a chapter
// with an introduction AND sections (i.e. a completely normal chapter)
// cannot match, and the parser restructures it. Fix: permissive sequences
// like `title introduction? (blocks)* section* conclusion?`; schema
// validity is the LSP's job, not the editor's.

describe("gaps: division content models reject normal documents", () => {
  it.fails("chapter with introduction AND sections is restructured", () => {
    expectLossless(`<chapter>
  <title>Graphs</title>
  <introduction>
    <p>What is a graph?</p>
  </introduction>
  <section>
    <title>Definitions</title>
    <p>Formally now.</p>
  </section>
</chapter>`);
  });
});

// ─── Comments, math internals, titles ────────────────────────────────────────

describe("gaps: comments and special content", () => {
  it.fails("XML comments are deleted", () => {
    // cleanPtx preserves comments (xast keeps them), but TipTap's HTML
    // parser drops comment nodes and json2ptx has no way to emit them.
    // Fix: convert comments to a dedicated node (or rawptx) in cleanPtx.
    expectLossless(`<section>
  <title>Notes</title>
  <!-- TODO: rewrite this paragraph -->
  <p>Draft text.</p>
</section>`);
  });

  it.fails("<md> with <mrow> children is corrupted into escaped text", () => {
    // mrow is not in KNOWN_TAGS, so each row gets rawptx-wrapped INSIDE
    // <md>, whose content model is text* (extensions/Math.ts). The tags
    // collapse to text and are then entity-escaped on serialization.
    // Fix: model mrow, or treat md-with-mrows as rawptx until modeled.
    expectLossless(`<p>Align:
  <md>
    <mrow>a \\amp= b</mrow>
    <mrow>c \\amp= d</mrow>
  </md>
</p>`);
  });

  it.fails("math inside <title> is flattened to text", () => {
    // Two stacked causes: (1) <title> is a real HTML tag with raw-text
    // (RCDATA) parsing, so nested tags are not parsed as elements; (2) the
    // Title node's content model is text* (extensions/Title.ts), which
    // could not hold an <m> node anyway. Fix: rename the rendered tag away
    // from <title> during cleanPtx (e.g. <ptxtitle>) and widen content to
    // inline*.
    expectLossless(`<section>
  <title>The number <m>e</m></title>
  <p>Body.</p>
</section>`);
  });
});

// ─── Serializer (json2ptx) limitations ───────────────────────────────────────

describe("gaps: json2ptx serializer limitations", () => {
  it.fails("nested/overlapping marks lose all but the first mark", () => {
    // json2ptx assumes "only one mark per text node" (json2ptx.ts) — text
    // carrying [em, term] emits only em. Fix: emit nested tags for the full
    // mark set (and stabilize order).
    expectLossless(`<p><em>All <term>nested</term> emphasis</em> here.</p>`);
  });

  it.fails(
    "attribute values containing & are emitted unescaped (malformed XML)",
    () => {
      // xast decodes href="...&amp;..." to a raw & in the attribute value;
      // json2ptx writes attribute values verbatim with no XML escaping
      // (json2ptx.ts processNode), producing not-well-formed output. Fix:
      // escape &, <, " in attribute values in json2ptx.
      expectLossless(
        `<p><url href="https://example.com/?a=1&amp;b=2">link</url></p>`,
      );
    },
  );
});

// ─── Normalization (not strictly loss, but changes the document) ────────────

describe("gaps: structural normalization the guard must flag", () => {
  it.fails("<li> with bare text is rewritten to <li><p>…</p></li>", () => {
    // TipTap's ListItem requires a leading paragraph, so bare-text items
    // get wrapped. Semantically harmless in PreTeXt, but it IS a rewrite of
    // untouched content, so the strict guard refuses it. Fix options:
    // teach the comparison to tolerate this specific normalization, or use
    // a ListItem variant whose content is `paragraph | inline*`.
    expectLossless(`<ul>
  <li>plain text item</li>
  <li>another one</li>
</ul>`);
  });
});
