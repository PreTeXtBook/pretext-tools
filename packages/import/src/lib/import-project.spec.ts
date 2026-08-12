import { describe, expect, it } from "vitest";
import { importProjectFromFiles } from "./upload";
import type { ImportedProjectSuccess } from "./types";

function bytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) arr[i] = i % 256;
  return arr;
}

const PUBLICATION = `<?xml version="1.0" encoding="UTF-8"?>
<publication>
  <source>
    <directories external="assets" generated="generated"/>
  </source>
  <common>
    <chunking level="2"/>
  </common>
  <html>
    <baseurl href="https://example.com/book"/>
  </html>
</publication>
`;

/** A realistic pretext-cli project, nested under an archive directory. */
function projectFiles(): Record<string, string> {
  return {
    "my-book-main/project.ptx": `<?xml version="1.0" encoding="UTF-8"?>
<project ptx-version="2">
  <targets>
    <target name="web" format="html" source="main.ptx" publication="publication.ptx" output-dir="web"/>
    <target name="print" format="pdf" source="main.ptx" publication="publication.ptx"/>
  </targets>
</project>`,
    "my-book-main/publication/publication.ptx": PUBLICATION,
    "my-book-main/source/main.ptx": `<?xml version="1.0" encoding="UTF-8"?>
<pretext xmlns:xi="http://www.w3.org/2001/XInclude">
  <docinfo><macros>\\newcommand{\\R}{\\mathbb{R}}</macros></docinfo>
  <book xml:id="my-book">
    <title>A Real Book</title>
    <xi:include href="frontmatter.ptx"/>
    <xi:include href="ch-intro.ptx"/>
    <xi:include href="ch-body.ptx"/>
  </book>
</pretext>`,
    "my-book-main/source/frontmatter.ptx": `<?xml version="1.0" encoding="UTF-8"?>
<frontmatter xml:id="fm"><preface xml:id="pref"><title>Preface</title><p>Why.</p></preface></frontmatter>`,
    "my-book-main/source/ch-intro.ptx": `<?xml version="1.0" encoding="UTF-8"?>
<chapter xml:id="intro"><title>Introduction</title><p>Hello.</p></chapter>`,
    "my-book-main/source/ch-body.ptx": `<?xml version="1.0" encoding="UTF-8"?>
<chapter xml:id="body" xmlns:xi="http://www.w3.org/2001/XInclude">
  <title>Body</title>
  <xi:include href="body/sec-one.ptx"/>
</chapter>`,
    "my-book-main/source/body/sec-one.ptx": `<?xml version="1.0" encoding="UTF-8"?>
<section xml:id="one"><title>First</title><p>Text.</p></section>`,
    "my-book-main/README.md": "# my-book\n\nBuild with pretext build.",
    "my-book-main/requirements.txt": "pretext==2.9\n",
    "my-book-main/output/web/index.html": "<html>stale build</html>",
  };
}

function importProject(
  overrides: Partial<Record<string, string>> = {},
  options = {},
): ImportedProjectSuccess {
  const result = importProjectFromFiles(
    { ...projectFiles(), ...overrides } as Record<string, string>,
    { assets: { "my-book-main/assets/diagram.png": bytes(8) }, ...options },
  );
  if ("pretextError" in result) {
    throw new Error(`unexpected error: ${result.pretextError}`);
  }
  return result;
}

describe("importing an existing PreTeXt project", () => {
  it("follows the first target of project.ptx", () => {
    const result = importProject();

    expect(result.sourcePath).toBe("my-book-main/source/main.ptx");
    expect(result.analysis.manifest?.projectRoot).toBe("my-book-main");
    expect(result.analysis.manifest?.targets.map((t) => t.name)).toEqual([
      "web",
      "print",
    ]);
    expect(result.analysis.primary?.reason).toBe("manifest-target");
    expect(result.analysis.primary?.targetName).toBe("web");
    expect(result.documentKind).toBe("book");
  });

  it("re-splits the resolved tree by division, including frontmatter", () => {
    const { project } = importProject();

    const types = project.divisions.map((d) => `${d.type}:${d.xmlId}`);
    expect(types).toContain("book:my-book");
    expect(types).toContain("frontmatter:fm");
    expect(types).toContain("chapter:intro");
    expect(types).toContain("chapter:body");

    // Depth 1 by default: the chapter's section stays inside its chapter.
    expect(types).not.toContain("section:one");
    const body = project.divisions.find((d) => d.xmlId === "body");
    expect(body?.content).toContain("<title>First</title>");

    const root = project.divisions.find((d) => d.isRoot);
    expect(root?.content).toContain('<plus:frontmatter ref="fm"/>');
    expect(root?.content).toContain('<plus:chapter ref="intro"/>');
  });

  it("splits deeper when asked", () => {
    const { project } = importProject({}, { splitLevel: 2 });
    const types = project.divisions.map((d) => `${d.type}:${d.xmlId}`);
    expect(types).toContain("section:one");
    expect(types).toContain("preface:pref");

    const body = project.divisions.find((d) => d.xmlId === "body");
    expect(body?.content).toContain('<plus:section ref="one"/>');
  });

  it("keeps the project's own paths, publication file, and assets", () => {
    const result = importProject();

    expect(result.projectLayout).toMatchObject({
      mainSourcePath: "source/main.ptx",
      publicationPath: "publication/publication.ptx",
      preserved: true,
    });

    // The author's publication file survives byte for byte.
    expect(result.outputFiles["publication/publication.ptx"]).toBe(PUBLICATION);
    // Non-source project files come along at their project-relative paths.
    expect(result.outputFiles["README.md"]).toContain("# my-book");
    expect(result.outputFiles["requirements.txt"]).toBe("pretext==2.9\n");
    // Assets keep the path the document already references.
    expect(result.outputAssets["assets/diagram.png"]).toEqual(bytes(8));
    expect(result.outputAssets["source/assets/diagram.png"]).toBeUndefined();
  });

  it("drops stale build output and the consumed source files", () => {
    const result = importProject();

    expect(result.outputFiles["output/web/index.html"]).toBeUndefined();
    // ch-intro.ptx was folded into the tree and re-emitted by the splitter, so
    // the original must not also be copied through.
    expect(Object.keys(result.outputFiles)).not.toContain(
      "my-book-main/source/ch-intro.ptx",
    );
  });

  it("rewrites project.ptx to keep every original target", () => {
    const manifest = importProject().outputFiles["project.ptx"];

    expect(manifest).toContain('<target name="web">');
    expect(manifest).toContain('<target name="print">');
    expect(manifest).toContain("<format>html</format>");
    expect(manifest).toContain("<format>pdf</format>");
    expect(manifest).toContain("<source>source/main.ptx</source>");
    expect(manifest).toContain(
      "<publication>publication/publication.ptx</publication>",
    );
    // The v2 attribute form is relative to the project's output directory;
    // the regenerated child-element form is relative to the project root.
    expect(manifest).toContain("<output-dir>output/web</output-dir>");
  });

  it("writes one source file per division with resolved xi:includes", () => {
    const files = importProject().outputFiles;

    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "source/main.ptx",
        "source/frontmatter.ptx",
        "source/ch-intro.ptx",
        "source/ch-body.ptx",
      ]),
    );
    expect(files["source/main.ptx"]).toContain(
      '<xi:include href="ch-intro.ptx"/>',
    );
    expect(files["source/main.ptx"]).toContain(
      '<xi:include href="frontmatter.ptx"/>',
    );
    // docinfo is re-inlined into the main file, not lost to the pool.
    expect(files["source/main.ptx"]).toContain("<macros>");
  });

  it("nests deeper divisions under their parent's directory", () => {
    const files = importProject({}, { splitLevel: 2 }).outputFiles;

    expect(files["source/ch-body/sec-one.ptx"]).toContain(
      "<title>First</title>",
    );
    expect(files["source/ch-body.ptx"]).toContain(
      '<xi:include href="ch-body/sec-one.ptx"/>',
    );
    expect(files["source/frontmatter/preface.ptx"]).toContain(
      "<title>Preface</title>",
    );
  });

  it("can be told to ignore the existing layout", () => {
    const result = importProject({}, { preserveProjectLayout: false });

    expect(result.projectLayout.preserved).toBe(false);
    expect(result.outputFiles["publication/publication.ptx"]).not.toBe(
      PUBLICATION,
    );
    expect(result.outputAssets["source/assets/diagram.png"]).toEqual(bytes(8));
  });

  it("follows a named target's source when the user picks one", () => {
    const files = projectFiles();
    files["my-book-main/project.ptx"] = `<project ptx-version="2">
  <targets>
    <target name="web" format="html" source="main.ptx"/>
    <target name="sample" format="html" source="sample.ptx"/>
  </targets>
</project>`;
    files["my-book-main/source/sample.ptx"] =
      `<pretext><article xml:id="samp"><title>Sample</title><p>Short.</p></article></pretext>`;

    const result = importProjectFromFiles(files, {
      mainFile: "my-book-main/source/sample.ptx",
    });
    if ("pretextError" in result) throw new Error(result.pretextError);

    expect(result.sourcePath).toBe("my-book-main/source/sample.ptx");
    expect(result.documentKind).toBe("article");
    expect(result.projectLayout.mainSourcePath).toBe("source/sample.ptx");
    // The other target's source was never consumed, so it is carried over.
    expect(result.outputFiles["source/main.ptx"]).toBeDefined();
  });

  it("offers every candidate root and format to the host", () => {
    const files = projectFiles();
    files["my-book-main/legacy/book.tex"] =
      "\\documentclass{book}\n\\title{Legacy}\n\\begin{document}\n\\chapter{Old}\nText.\n\\end{document}";

    const result = importProjectFromFiles(files);
    if ("pretextError" in result) throw new Error(result.pretextError);

    expect(result.analysis.formats).toEqual(["pretext", "latex", "markdown"]);
    const paths = result.analysis.candidates.map((c) => c.path);
    expect(paths).toContain("my-book-main/source/main.ptx");
    expect(paths).toContain("my-book-main/legacy/book.tex");
    // The manifest still wins by default.
    expect(result.sourcePath).toBe("my-book-main/source/main.ptx");
  });

  it("honours a forced source format over the manifest", () => {
    const files = projectFiles();
    files["my-book-main/legacy/book.tex"] =
      "\\documentclass{book}\n\\title{Legacy}\n\\begin{document}\n\\chapter{Old}\nText.\n\\end{document}";

    const result = importProjectFromFiles(files, { sourceFormat: "latex" });
    if ("pretextError" in result) throw new Error(result.pretextError);

    expect(result.sourcePath).toBe("my-book-main/legacy/book.tex");
    expect(result.sourceType).toBe("tex");
    expect(result.projectLayout.preserved).toBe(false);
  });
});
