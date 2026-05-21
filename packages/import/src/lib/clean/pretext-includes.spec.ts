import { describe, expect, it } from "vitest";
import {
  expandPretextIncludes,
  findLikelyMainPretextPath,
} from "./pretext-includes";

describe("findLikelyMainPretextPath", () => {
  it("prefers a file whose root element is <pretext>/<book>/<article>", () => {
    const files = {
      "source/ch-1.ptx": "<chapter><title>One</title></chapter>",
      "source/main.ptx": '<?xml version="1.0"?>\n<pretext><book/></pretext>',
    };
    expect(findLikelyMainPretextPath(files)).toBe("source/main.ptx");
  });

  it("falls back to the first sorted ptx file", () => {
    const files = {
      "z.ptx": "<chapter/>",
      "a.ptx": "<chapter/>",
    };
    expect(findLikelyMainPretextPath(files)).toBe("a.ptx");
  });

  it("returns null when no ptx/xml files are present", () => {
    expect(findLikelyMainPretextPath({ "a.tex": "x" })).toBeNull();
  });
});

describe("expandPretextIncludes", () => {
  it("inlines a single xi:include", () => {
    const files = {
      "main.ptx":
        '<book><xi:include href="ch-1.ptx"/></book>',
      "ch-1.ptx": "<chapter><title>One</title></chapter>",
    };
    const { expandedText, expandedCount, missingIncludes } =
      expandPretextIncludes(files["main.ptx"], "main.ptx", files);
    expect(expandedText).toBe(
      "<book><chapter><title>One</title></chapter></book>",
    );
    expect(expandedCount).toBe(1);
    expect(missingIncludes).toEqual([]);
  });

  it("resolves include paths relative to the base file's directory", () => {
    const files = {
      "source/main.ptx":
        '<book><xi:include href="ch-1.ptx"/></book>',
      "source/ch-1.ptx": "<chapter/>",
    };
    const { expandedText, expandedCount } = expandPretextIncludes(
      files["source/main.ptx"],
      "source/main.ptx",
      files,
    );
    expect(expandedText).toContain("<chapter/>");
    expect(expandedCount).toBe(1);
  });

  it("strips a leading XML prolog from included content", () => {
    const files = {
      "main.ptx": '<book><xi:include href="ch.ptx"/></book>',
      "ch.ptx": '<?xml version="1.0"?>\n<chapter/>',
    };
    const { expandedText } = expandPretextIncludes(
      files["main.ptx"],
      "main.ptx",
      files,
    );
    expect(expandedText).toBe("<book><chapter/></book>");
  });

  it("records missing includes without throwing", () => {
    const files = { "main.ptx": '<book><xi:include href="missing.ptx"/></book>' };
    const { expandedCount, missingIncludes } = expandPretextIncludes(
      files["main.ptx"],
      "main.ptx",
      files,
    );
    expect(expandedCount).toBe(0);
    expect(missingIncludes).toEqual(["missing.ptx"]);
  });

  it("recursively expands nested includes", () => {
    const files = {
      "main.ptx": '<book><xi:include href="ch.ptx"/></book>',
      "ch.ptx": '<chapter><xi:include href="sec.ptx"/></chapter>',
      "sec.ptx": "<section><title>S</title></section>",
    };
    const { expandedText, expandedCount } = expandPretextIncludes(
      files["main.ptx"],
      "main.ptx",
      files,
    );
    expect(expandedText).toContain("<section><title>S</title></section>");
    expect(expandedCount).toBe(2);
  });
});
