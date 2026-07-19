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

// ─── Mark nesting order ──────────────────────────────────────────────────────
//
// Marks spanning several inline nodes and canonically-nested marks are
// handled now (json2ptx's processChildren run-merging — see the promoted
// fixtures in roundtrip.spec.ts). The remaining boundary is fundamental:
// ProseMirror stores marks as SETS in schema-rank order (em, alert, term,
// c — set in Inline.ts) and never records the source's nesting order, so
// nesting that runs AGAINST the rank order is rewritten to canonical
// order on save. Semantically equivalent markup, but still a rewrite, so
// the guard refuses it. A real fix would need to record nesting order
// out-of-band; low priority — reverse-nested marks are rare in practice.

describe("gaps: mark nesting order is canonicalized", () => {
  it.fails("<term> wrapping <em> comes back with canonical nesting", () => {
    // Expected: <term>All <em>nested</em> here</term>
    // Actual:   <term>All </term><em><term>nested</term></em><term> here</term>
    expectLossless(`<p><term>All <em>nested</em> here</term></p>`);
  });
});

// ─── Attribute loss on MARKS ─────────────────────────────────────────────────
//
// NODE attributes are preserved generically now (PtxSourceAttributes in
// editorExtensions.ts — see the promoted fixtures in roundtrip.spec.ts).
// Marks (em/term/alert/c in Inline.ts) still declare no attributes, so an
// attribute on a mark element is dropped. Extending the catch-all to marks
// needs care: json2ptx's run-merging (processChildren) compares marks by
// NAME only, and two adjacent spans with different attrs must not merge.

describe("gaps: attributes on mark elements are dropped", () => {
  it.fails("permid on <em> is dropped", () => {
    expectLossless(`<p><em permid="mark-id">important</em> words.</p>`);
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

// ─── Titles ──────────────────────────────────────────────────────────────────

describe("gaps: title content", () => {
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
