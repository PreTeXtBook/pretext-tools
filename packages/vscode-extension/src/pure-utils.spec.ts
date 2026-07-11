import { describe, it, expect } from "vitest";
import { stripColorCodes, buildSpellCheckIgnorePatterns } from "./pure-utils";
import { SpellCheckScope } from "./types";

describe("stripColorCodes", () => {
  it("removes ANSI SGR color codes", () => {
    expect(stripColorCodes("\x1B[31mred\x1B[0m text")).toBe("red text");
  });

  it("leaves plain text untouched", () => {
    expect(stripColorCodes("no colors here")).toBe("no colors here");
  });
});

describe("buildSpellCheckIgnorePatterns", () => {
  const allCheck: SpellCheckScope = {
    comments: "Check",
    inlineMath: "Check",
    displayMath: "Check",
    inlineCode: "Check",
    blockCode: "Check",
    latexImage: "Check",
    tags: "Check",
  };

  it("returns no patterns when nothing is ignored", () => {
    expect(buildSpellCheckIgnorePatterns(allCheck)).toEqual([]);
  });

  it("returns an empty list for undefined scopes", () => {
    expect(buildSpellCheckIgnorePatterns(undefined)).toEqual([]);
  });

  it("adds a pattern only for scopes marked Ignore", () => {
    const patterns = buildSpellCheckIgnorePatterns({
      ...allCheck,
      inlineMath: "Ignore",
      comments: "Ignore",
    });
    expect(patterns).toEqual(["<!--.*?-->", "<m>.*?</m>"]);
  });

  it("produces a display-math regex that actually spans multiple lines", () => {
    const [pattern] = buildSpellCheckIgnorePatterns({
      ...allCheck,
      displayMath: "Ignore",
    });
    const re = new RegExp(pattern);
    expect(re.test("<md>\n  a = b\n</md>")).toBe(true);
    // Should match the paired variants but not close across the wrong tag.
    expect("<me>x</me>".match(re)?.[0]).toBe("<me>x</me>");
  });
});
