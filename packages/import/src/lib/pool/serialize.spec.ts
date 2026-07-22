import { describe, expect, it } from "vitest";
import { buildDivisionPool } from "./division-pool";
import { serializeProjectToFiles } from "./serialize-files";
import { serializeProjectToPlusPayload } from "./serialize-plus";
import type { ImportedProject } from "../types";

const BOOK_SOURCE = `<pretext>
<docinfo><macros>\\newcommand{\\R}{\\mathbb R}</macros></docinfo>
<book>
<title>Book</title>
<chapter xml:id="intro">
<title>Introduction</title>
<section xml:id="setup"><title>Setup</title><p>s</p></section>
<p>Welcome.</p>
</chapter>
<chapter xml:id="methods"><title>Methods</title><p>m</p></chapter>
</book>
</pretext>`;

describe("serializeProjectToFiles", () => {
  it("writes one file per division with xi:include hierarchy", () => {
    const { project } = buildDivisionPool(BOOK_SOURCE);
    const { files } = serializeProjectToFiles(project);

    expect(Object.keys(files).sort()).toEqual([
      "project.ptx",
      "publication/publication.ptx",
      "source/ch-intro.ptx",
      "source/ch-methods.ptx",
      "source/main.ptx",
    ]);

    const main = files["source/main.ptx"];
    expect(main.startsWith("<?xml")).toBe(true);
    expect(main).toContain("xmlns:xi=");
    expect(main).toContain("<docinfo>");
    expect(main).toContain('<xi:include href="ch-intro.ptx"/>');
    expect(main).toContain('<xi:include href="ch-methods.ptx"/>');
    expect(main).not.toContain("<plus:");
    expect(main).not.toContain("Welcome.");

    expect(files["source/ch-intro.ptx"]).toContain("Welcome.");
    expect(files["source/ch-intro.ptx"].startsWith("<?xml")).toBe(true);
    expect(files["project.ptx"]).toContain('ptx-version="2"');
  });

  it("nests split sections under a per-chapter directory", () => {
    const { project } = buildDivisionPool(BOOK_SOURCE, {
      splitSections: true,
    });
    const { files } = serializeProjectToFiles(project);

    expect(files["source/ch-intro/sec-setup.ptx"]).toContain("<p>s</p>");
    const chapter = files["source/ch-intro.ptx"];
    expect(chapter).toContain('<xi:include href="ch-intro/sec-setup.ptx"/>');
    // A file containing xi:include must declare the namespace itself.
    expect(chapter).toContain("xmlns:xi=");
  });

  it("keeps a plain article main file free of the xi namespace", () => {
    const { project } = buildDivisionPool(
      "<pretext><article><title>A</title><p>x</p></article></pretext>",
    );
    const { files } = serializeProjectToFiles(project);
    expect(files["source/main.ptx"]).toContain("<pretext>");
    expect(files["source/main.ptx"]).not.toContain("xmlns:xi=");
  });

  it("writes orphan divisions even when nothing references them", () => {
    const project: ImportedProject = {
      title: "T",
      docinfo: "",
      documentKind: "book",
      divisions: [
        {
          xmlId: "document",
          type: "book",
          title: "T",
          sourceFormat: "pretext",
          content: '<book xml:id="document"><title>T</title></book>',
          isRoot: true,
        },
        {
          xmlId: "loose",
          type: "chapter",
          title: "Loose",
          sourceFormat: "pretext",
          content: '<chapter xml:id="loose"><title>Loose</title></chapter>',
          isRoot: false,
        },
      ],
      assets: [],
    };
    const { files } = serializeProjectToFiles(project, {
      includeScaffold: false,
    });
    expect(Object.keys(files).sort()).toEqual([
      "source/ch-loose.ptx",
      "source/main.ptx",
    ]);
    expect(files["source/main.ptx"]).not.toContain("xi:include");
  });
});

describe("serializeProjectToPlusPayload", () => {
  it("maps the pool onto the Rails import_params shape", () => {
    const { project } = buildDivisionPool(BOOK_SOURCE, {
      assets: { "img/plot.png": new Uint8Array([7, 7]) },
    });
    const payload = serializeProjectToPlusPayload(project);

    expect(payload.title).toBe("Book");
    expect(payload.document_type).toBe("book");
    expect(payload.docinfo).toContain("<macros>");

    expect(payload.divisions_attributes.filter((d) => d.is_root)).toHaveLength(
      1,
    );
    const rootRecord = payload.divisions_attributes.find((d) => d.is_root);
    expect(rootRecord?.ref).toBe("document");
    expect(rootRecord?.source).toContain('<plus:chapter ref="intro"/>');
    expect(rootRecord?.source_format).toBe("pretext");
    // The import endpoint permits no `id`/`_destroy` — every division is a
    // brand-new row, so the payload must not carry one.
    for (const record of payload.divisions_attributes) {
      expect(record).not.toHaveProperty("id");
    }

    expect(payload.assets_attributes).toHaveLength(1);
    const asset = payload.assets_attributes[0];
    expect(asset.kind).toBe("file");
    expect(asset.ref).toBe("plot");
    expect(asset.title).toBe("plot.png");
    expect(asset.short_description).toBe("plot.png");
    expect(asset).not.toHaveProperty("id");
    expect(asset.file.filename).toBe("plot.png");
    expect(asset.file.content_type).toBe("image/png");
    // Bytes travel as base64 in `file.data` — decode and check round trip.
    expect(typeof asset.file.data).toBe("string");
    expect(Buffer.from(asset.file.data, "base64")).toEqual(Buffer.from([7, 7]));
  });
});
