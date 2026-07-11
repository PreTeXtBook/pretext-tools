import { describe, expect, it } from "vitest";
import { buildPretextProjectFiles } from "./build-project-files";

describe("buildPretextProjectFiles — article", () => {
  it("emits a single source/main.ptx plus project.ptx and publication.ptx", () => {
    const source =
      "<pretext><article><title>Hi</title><p>body</p></article></pretext>";
    const { files, documentKind } = buildPretextProjectFiles(source);
    expect(documentKind).toBe("article");
    expect(Object.keys(files).sort()).toEqual([
      "project.ptx",
      "publication/publication.ptx",
      "source/main.ptx",
    ]);
    expect(files["source/main.ptx"]).toContain("<article>");
    expect(files["project.ptx"]).toContain("<source>source/main.ptx</source>");
  });

  it("wraps a bare <article> in <pretext>", () => {
    const { files } = buildPretextProjectFiles("<article><p>x</p></article>");
    expect(files["source/main.ptx"]).toMatch(/<pretext>[\s\S]*<article>/);
  });
});

describe("buildPretextProjectFiles — book", () => {
  const bookSource = `
<pretext>
  <book xml:id="mybook">
    <chapter xml:id="intro">
      <title>Intro</title>
      <p>One.</p>
    </chapter>
    <chapter xml:id="methods">
      <title>Methods</title>
      <p>Two.</p>
    </chapter>
  </book>
</pretext>`.trim();

  it("splits each chapter into its own file", () => {
    const { files, documentKind } = buildPretextProjectFiles(bookSource);
    expect(documentKind).toBe("book");
    expect(files["source/ch-intro.ptx"]).toContain('<chapter xml:id="intro"');
    expect(files["source/ch-methods.ptx"]).toContain("<title>Methods</title>");
  });

  it("main.ptx references chapters via xi:include with the xinclude namespace", () => {
    const { files } = buildPretextProjectFiles(bookSource);
    const main = files["source/main.ptx"];
    expect(main).toMatch(/xmlns:xi="http:\/\/www\.w3\.org\/2001\/XInclude"/);
    expect(main).toContain('<xi:include href="ch-intro.ptx"/>');
    expect(main).toContain('<xi:include href="ch-methods.ptx"/>');
    expect(main).not.toContain("Intro");
  });

  it("falls back to ch-NN slugs when chapters lack xml:id and records a warning", () => {
    const noIds = `<pretext><book><chapter><title>A</title></chapter><chapter><title>B</title></chapter></book></pretext>`;
    const { files, warnings } = buildPretextProjectFiles(noIds);
    expect(files["source/ch-01.ptx"]).toContain("<title>A</title>");
    expect(files["source/ch-02.ptx"]).toContain("<title>B</title>");
    expect(warnings.find((w) => w.category === "missing_xml_id")).toBeTruthy();
  });

  it("can additionally split sections within each chapter", () => {
    const src = `
<pretext>
  <book>
    <chapter xml:id="intro">
      <title>Intro</title>
      <section xml:id="why">
        <title>Why</title>
        <p>...</p>
      </section>
      <section xml:id="how">
        <title>How</title>
        <p>...</p>
      </section>
    </chapter>
  </book>
</pretext>`.trim();
    const { files } = buildPretextProjectFiles(src, { splitSections: true });
    expect(files["source/ch-intro.ptx"]).toContain(
      '<xi:include href="ch-intro/sec-why.ptx"/>',
    );
    expect(files["source/ch-intro/sec-why.ptx"]).toContain(
      "<title>Why</title>",
    );
    expect(files["source/ch-intro/sec-how.ptx"]).toContain(
      "<title>How</title>",
    );
  });

  it("respects an explicit documentKind override", () => {
    // input looks like an article but caller insists on book
    const { files, documentKind } = buildPretextProjectFiles(
      "<pretext><article><title>X</title></article></pretext>",
      { documentKind: "book" },
    );
    expect(documentKind).toBe("book");
    // No <book> in source — should still produce main.ptx with a warning
    expect(files["source/main.ptx"]).toBeTruthy();
  });
});
