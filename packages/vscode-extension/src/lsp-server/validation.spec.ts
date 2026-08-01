import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { documentSchemaKind, shouldValidate } from "./validation";

function doc(uri: string, text = "<pretext><book/></pretext>") {
  return TextDocument.create(uri, "pretext", 1, text);
}

const PUBLICATION = "<publication>\n  <common/>\n</publication>";
const MANIFEST = '<project ptx-version="2">\n  <targets/>\n</project>';

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

  // Both used to be excluded outright; they are now validated against their
  // own grammars rather than against PreTeXt's.
  it("validates the project.ptx manifest", () => {
    expect(shouldValidate(doc("file:///book/project.ptx", MANIFEST))).toBe(
      true,
    );
  });

  it("validates publication files", () => {
    expect(
      shouldValidate(
        doc("file:///book/publication/publication.ptx", PUBLICATION),
      ),
    ).toBe(true);
  });
});

describe("documentSchemaKind", () => {
  it("treats ordinary source files as PreTeXt documents", () => {
    expect(documentSchemaKind(doc("file:///book/source/main.ptx"))).toBe(
      "pretext",
    );
    expect(documentSchemaKind(doc("file:///book/source/ch1.xml"))).toBe(
      "pretext",
    );
  });

  it("identifies the manifest by filename", () => {
    expect(documentSchemaKind(doc("file:///book/project.ptx", MANIFEST))).toBe(
      "project",
    );
  });

  it("identifies a publication file by its root element, whatever its name", () => {
    // The name is only a convention — the manifest is what points at it — so
    // detection has to key off the content.
    expect(
      documentSchemaKind(
        doc("file:///book/publication/publication.ptx", PUBLICATION),
      ),
    ).toBe("publication");
    expect(
      documentSchemaKind(doc("file:///book/pubs/print.xml", PUBLICATION)),
    ).toBe("publication");
  });

  it("prefers the manifest when a project.ptx also mentions <publication>", () => {
    // A v2 manifest legitimately references a publication file; that must not
    // flip it onto the publication grammar.
    const manifest = `<project ptx-version="2">
  <targets>
    <target name="web" format="html" publication="publication/publication.ptx"/>
  </targets>
</project>`;
    expect(documentSchemaKind(doc("file:///book/project.ptx", manifest))).toBe(
      "project",
    );
  });
});
