import { describe, expect, it } from "vitest";
import { OFF_PAGE_MESSAGE, rewriteXrefLinks } from "./xrefs.js";

describe("rewriteXrefLinks", () => {
  it("rewrites a link to a target on this page as a bare anchor", () => {
    const html = `<div id="thm-a">T</div><a href="sec-one.html#thm-a" class="internal">Theorem 1.1</a>`;
    expect(rewriteXrefLinks(html)).toContain(
      '<a href="#thm-a" class="internal">',
    );
  });

  it("makes a link to a target elsewhere inert, and says why", () => {
    const html = `<a href="sec-two.html#thm-b" class="internal" title="Theorem 2.1: Beta">Theorem 2.1</a>`;
    const out = rewriteXrefLinks(html);
    expect(out).not.toContain("href=");
    expect(out).toContain('aria-disabled="true"');
    // The link text is untouched, so the page still reads like the built one.
    expect(out).toContain(">Theorem 2.1</a>");
  });

  it("keeps the target's own tooltip alongside the explanation", () => {
    const html = `<a href="sec-two.html#thm-b" title="Theorem 2.1: Beta">x</a>`;
    expect(rewriteXrefLinks(html)).toContain(
      `title="Theorem 2.1: Beta — ${OFF_PAGE_MESSAGE}"`,
    );
  });

  it("uses a caller's wording when given one", () => {
    const html = `<a href="other.html#z">z</a>`;
    expect(
      rewriteXrefLinks(html, { offPageMessage: "Not in this preview." }),
    ).toContain('title="Not in this preview."');
  });

  it("escapes a tooltip built from author text", () => {
    const html = `<a href="o.html#z" title="A &quot;quoted&quot; title">z</a>`;
    const out = rewriteXrefLinks(html);
    expect(out).toContain("&quot;quoted&quot;");
    // Exactly one title attribute survives, so the tag stays well formed.
    expect(out.match(/title="/g)).toHaveLength(1);
  });

  it("neutralises a page link with no fragment, such as a contents entry", () => {
    const html = `<a href="sec-three.html" class="internal">Section 3</a>`;
    const out = rewriteXrefLinks(html);
    expect(out).not.toContain("href=");
    expect(out).toContain('aria-disabled="true"');
  });

  it("leaves external links and in-page anchors alone", () => {
    const html = [
      '<a href="https://pretextbook.org">PreTeXt</a>',
      '<a href="#ptx-content">Skip</a>',
      '<a href="#">Top</a>',
      '<a href="mailto:someone@example.com">Mail</a>',
    ].join("");
    expect(rewriteXrefLinks(html)).toBe(html);
  });

  it("leaves a whole-document render untouched", () => {
    const html = `<div id="thm-a">T</div><a href="#thm-a" class="internal">Theorem 1.1</a>`;
    expect(rewriteXrefLinks(html)).toBe(html);
  });

  it("repoints a same-page cross-reference inside display math", () => {
    const html = `<div id="eq-a">E</div><script>\\href{sec-one.html#eq-a}{(1)}</script>`;
    expect(rewriteXrefLinks(html)).toContain("\\href{#eq-a}{(1)}");
  });

  it("leaves an off-page display-math reference as it was", () => {
    const html = `<script>\\href{sec-two.html#eq-z}{(9)}</script>`;
    expect(rewriteXrefLinks(html)).toContain("\\href{sec-two.html#eq-z}");
  });
});
