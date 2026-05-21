import { describe, expect, it } from "vitest";
import {
  deleteComments,
  firstBracketedString,
  makeXMLSafe,
  trimJunk,
} from "./latex-utils";

describe("deleteComments", () => {
  it("removes line comments", () => {
    expect(deleteComments("Hello % comment\nworld")).toBe("Hello\nworld");
  });

  it("keeps escaped percents", () => {
    expect(deleteComments("100\\% off")).toBe("100\\% off");
  });

  it("removes comments at start of document", () => {
    expect(deleteComments("% top\nbody")).toBe("\nbody");
  });
});

describe("makeXMLSafe", () => {
  it("rewrites bare < and > as \\lt / \\gt", () => {
    expect(makeXMLSafe("a < b > c")).toBe("a \\lt b \\gt c");
  });

  it("normalizes labels with spaces and punctuation", () => {
    expect(makeXMLSafe("\\label{my section!}")).toBe("\\label{my_section-}");
  });

  it("normalizes refs to match the label rewrite", () => {
    expect(makeXMLSafe("see \\ref{my section}")).toBe("see \\ref{my_section}");
  });
});

describe("trimJunk", () => {
  it("collapses excess blank lines", () => {
    expect(trimJunk("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("drops everything after \\end{document}", () => {
    expect(trimJunk("a\n\\end{document}\nignored")).toBe("a\n");
  });

  it("strips leading whitespace and normalizes \\begin/\\section", () => {
    expect(trimJunk("\n  \\section *foo")).toBe("\\sectionfoo");
  });
});

describe("firstBracketedString", () => {
  it("returns the leading bracketed group and the rest", () => {
    expect(firstBracketedString("{abc}rest")).toEqual(["{abc}", "rest"]);
  });

  it("handles nested braces", () => {
    expect(firstBracketedString("{a{b}c}rest")).toEqual(["{a{b}c}", "rest"]);
  });

  it("returns ['', text] when input does not start with a brace", () => {
    expect(firstBracketedString("rest")).toEqual(["", "rest"]);
  });

  it("ignores escaped braces", () => {
    expect(firstBracketedString("{a\\{b}c}")).toEqual(["{a\\{b}", "c}"]);
  });
});
