import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { shouldValidate } from "./validation";

function doc(uri: string, text = "<pretext><book/></pretext>") {
  return TextDocument.create(uri, "pretext", 1, text);
}

describe("shouldValidate", () => {
  it("validates ordinary .ptx and .xml source files", () => {
    expect(shouldValidate(doc("file:///book/source/main.ptx"))).toBe(true);
    expect(shouldValidate(doc("file:///book/source/ch1.xml"))).toBe(true);
    // Extension matching is case-insensitive.
    expect(shouldValidate(doc("file:///book/source/CH2.PTX"))).toBe(true);
  });

  it("skips files that are not .ptx/.xml", () => {
    expect(shouldValidate(doc("file:///book/README.md"))).toBe(false);
    expect(shouldValidate(doc("file:///book/notes.txt"))).toBe(false);
  });

  it("skips the project.ptx manifest", () => {
    expect(shouldValidate(doc("file:///book/project.ptx"))).toBe(false);
  });

  it("skips publication files (detected by a <publication> root)", () => {
    const pub = doc(
      "file:///book/publication/publication.ptx",
      "<publication>\n  <common/>\n</publication>",
    );
    expect(shouldValidate(pub)).toBe(false);
  });
});
