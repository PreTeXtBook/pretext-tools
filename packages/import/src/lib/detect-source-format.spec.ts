import { describe, expect, it } from "vitest";
import { detectSourceFormat } from "./detect-source-format";

describe("detectSourceFormat", () => {
  it("detects PreTeXt by leading <", () => {
    expect(detectSourceFormat("<pretext><article/></pretext>")).toBe("pretext");
  });

  it("detects LaTeX via documentclass", () => {
    expect(detectSourceFormat("\\documentclass{article}\nHi")).toBe("latex");
  });

  it("detects Markdown via leading heading", () => {
    expect(detectSourceFormat("# Hello\nworld")).toBe("markdown");
  });

  it("falls back to PreTeXt for empty input", () => {
    expect(detectSourceFormat("")).toBe("pretext");
  });
});
