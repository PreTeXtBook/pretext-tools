import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { isProjectPtx } from "./is-project-ptx";

describe("isProjectPtx", () => {
  it("accepts a raw URI string ending in project.ptx", () => {
    expect(isProjectPtx("file:///home/me/book/project.ptx")).toBe(true);
  });

  it("rejects ordinary source files", () => {
    expect(isProjectPtx("file:///home/me/book/source/main.ptx")).toBe(false);
    expect(isProjectPtx("file:///home/me/book/source/ch1.xml")).toBe(false);
  });

  it("does not match files that merely contain the substring", () => {
    // A file literally named "my-project.ptx" still ends with "project.ptx",
    // so it is treated as a manifest. Guard against the more surprising case.
    expect(isProjectPtx("file:///home/me/project.ptx.bak")).toBe(false);
  });

  it("accepts a TextDocument by reading its uri", () => {
    const doc = TextDocument.create(
      "file:///home/me/book/project.ptx",
      "xml",
      1,
      "<project></project>",
    );
    expect(isProjectPtx(doc)).toBe(true);
  });
});
