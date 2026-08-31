import { describe, expect, it } from "vitest";
import { retargetFragment } from "./retarget";

describe("retargetFragment: shifting along the ladder", () => {
  it("demotes a section fragment into a subsection", () => {
    const result = retargetFragment(
      `<section xml:id="hw3"><title>Homework 3</title><p>Do it.</p></section>`,
      "subsection",
    );
    expect(result.delta).toBe(1);
    expect(result.topTag).toBe("section");
    expect(result.source).toBe(
      `<subsection xml:id="hw3"><title>Homework 3</title><p>Do it.</p></subsection>`,
    );
  });

  it("shifts nested divisions by the same delta", () => {
    const result = retargetFragment(
      `<chapter><title>C</title><section><title>S</title><subsection><title>SS</title></subsection></section></chapter>`,
      "section",
    );
    expect(result.delta).toBe(1);
    expect(result.source).toBe(
      `<section><title>C</title><subsection><title>S</title><subsubsection><title>SS</title></subsubsection></subsection></section>`,
    );
  });

  it("promotes when the target is shallower than the fragment", () => {
    const result = retargetFragment(
      `<subsection><title>S</title><subsubsection><title>T</title></subsubsection></subsection>`,
      "chapter",
    );
    expect(result.delta).toBe(-2);
    expect(result.source).toBe(
      `<chapter><title>S</title><section><title>T</title></section></chapter>`,
    );
  });

  it("preserves attributes and self-closing tags", () => {
    const result = retargetFragment(
      `<section xml:id="a" xmlns:xi="http://www.w3.org/2001/XInclude"><p/></section>`,
      "subsection",
    );
    expect(result.source).toBe(
      `<subsection xml:id="a" xmlns:xi="http://www.w3.org/2001/XInclude"><p/></subsection>`,
    );
  });

  it("is a no-op when the fragment already sits at the target level", () => {
    const source = `<section xml:id="a"><p>Text.</p></section>`;
    const result = retargetFragment(source, "section");
    expect(result.delta).toBe(0);
    expect(result.source).toBe(source);
  });
});

describe("retargetFragment: measuring the delta", () => {
  it("measures from the shallowest tag, so nothing escapes the target level", () => {
    // A fragment that leads with a <section> but also holds a <chapter>: the
    // chapter sets the delta, so the section lands *below* the target rather
    // than climbing out of it.
    const result = retargetFragment(
      `<section><title>A</title></section><chapter><title>B</title></chapter>`,
      "subsection",
    );
    expect(result.topTag).toBe("chapter");
    expect(result.delta).toBe(2);
    expect(result.source).toBe(
      `<subsubsection><title>A</title></subsubsection><subsection><title>B</title></subsection>`,
    );
  });

  it("sees through a document wrapper to the divisions inside", () => {
    const result = retargetFragment(
      `<pretext><article><section><title>S</title></section></article></pretext>`,
      "subsection",
    );
    expect(result.delta).toBe(1);
    expect(result.source).toContain(
      "<subsection><title>S</title></subsection>",
    );
    expect(result.source).toContain("<article>");
  });

  it("leaves a fragment with no depth-indexed division alone", () => {
    const source = `<exercises><title>Practice</title><exercise><p>Go.</p></exercise></exercises>`;
    const result = retargetFragment(source, "subsection");
    expect(result.delta).toBe(0);
    expect(result.topTag).toBeUndefined();
    expect(result.source).toBe(source);
  });

  it("leaves the fragment alone when the target is off the ladder", () => {
    const source = `<section><title>S</title></section>`;
    expect(retargetFragment(source, "appendix").source).toBe(source);
  });
});

describe("retargetFragment: off-ladder tags and overflow", () => {
  it("passes role-named divisions through untouched", () => {
    const result = retargetFragment(
      `<chapter><title>C</title><exercises><title>E</title></exercises><appendix><title>A</title></appendix></chapter>`,
      "section",
    );
    expect(result.source).toContain("<exercises><title>E</title></exercises>");
    expect(result.source).toContain("<appendix><title>A</title></appendix>");
    expect(result.source.startsWith("<section>")).toBe(true);
  });

  it("turns overflow past subsubsection into paragraphs", () => {
    const result = retargetFragment(
      `<section><title>S</title><subsection><title>T</title></subsection></section>`,
      "subsubsection",
    );
    expect(result.source).toBe(
      `<subsubsection><title>S</title><paragraphs><title>T</title></paragraphs></subsubsection>`,
    );
    expect(result.overflowed).toEqual(["subsection"]);
  });

  it("reports each overflowed level once, shallowest first", () => {
    const result = retargetFragment(
      `<section><subsection><subsubsection/></subsection><subsection/></section>`,
      "subsubsection",
    );
    expect(result.overflowed).toEqual(["subsection", "subsubsection"]);
  });

  it("retargets pool placeholders alongside real elements", () => {
    const result = retargetFragment(
      `<section xml:id="a"><title>A</title><plus:subsection ref="b"/></section>`,
      "subsection",
    );
    expect(result.source).toBe(
      `<subsection xml:id="a"><title>A</title><plus:subsubsection ref="b"/></subsection>`,
    );
  });

  it("ignores division tags mentioned inside comments", () => {
    const result = retargetFragment(
      `<section><!-- a <chapter> once lived here --><p>Now.</p></section>`,
      "subsection",
    );
    expect(result.delta).toBe(1);
    expect(result.source).toContain("<!-- a <chapter> once lived here -->");
  });
});
