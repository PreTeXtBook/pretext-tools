import { describe, expect, it } from "vitest";
import {
  defaultManifestTarget,
  findProjectManifest,
  parseProjectManifest,
} from "./manifest";

const V2 = `<?xml version="1.0" encoding="UTF-8"?>
<project ptx-version="2">
  <targets>
    <target name="web" format="html" source="main.ptx" publication="publication.ptx" output-dir="web"/>
    <target name="print" format="pdf" source="main.ptx" publication="print.ptx"/>
  </targets>
</project>`;

const V1 = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <targets>
    <target name="web">
      <format>html</format>
      <source>source/main.ptx</source>
      <publication>publication/publication.ptx</publication>
      <output-dir>output/web</output-dir>
    </target>
  </targets>
</project>`;

describe("parseProjectManifest", () => {
  it("resolves v2 source/publication attributes against the project directories", () => {
    const manifest = parseProjectManifest(V2, "project.ptx");
    expect(manifest).not.toBeNull();
    expect(manifest!.ptxVersion).toBe("2");
    expect(manifest!.targets).toHaveLength(2);
    expect(manifest!.targets[0]).toMatchObject({
      name: "web",
      format: "html",
      source: "source/main.ptx",
      publication: "publication/publication.ptx",
      outputDir: "output/web",
      standalone: false,
    });
    expect(manifest!.targets[1].publication).toBe("publication/print.ptx");
  });

  it("resolves v1 child elements against the project root", () => {
    const manifest = parseProjectManifest(V1, "project.ptx");
    expect(manifest!.targets[0]).toMatchObject({
      name: "web",
      format: "html",
      source: "source/main.ptx",
      publication: "publication/publication.ptx",
      outputDir: "output/web",
    });
  });

  it("honours project-level directory attributes", () => {
    const manifest = parseProjectManifest(
      `<project ptx-version="2" source="ptx" publication="pub">
         <targets><target name="web" format="html" source="book.ptx"/></targets>
       </project>`,
      "project.ptx",
    );
    expect(manifest!.sourceDir).toBe("ptx");
    expect(manifest!.targets[0].source).toBe("ptx/book.ptx");
  });

  it("defaults a target with no source to <sourceDir>/main.ptx", () => {
    const manifest = parseProjectManifest(
      `<project ptx-version="2"><targets><target name="web" format="html"/></targets></project>`,
      "project.ptx",
    );
    expect(manifest!.targets[0].source).toBe("source/main.ptx");
  });

  it("handles a legacy manifest with no <targets>", () => {
    const manifest = parseProjectManifest(
      `<project><source>source/book.ptx</source></project>`,
      "project.ptx",
    );
    expect(manifest!.targets).toHaveLength(1);
    expect(manifest!.targets[0].source).toBe("source/book.ptx");
  });

  it("records the project root when the manifest is nested in an archive", () => {
    const manifest = parseProjectManifest(V2, "my-book-main/project.ptx");
    expect(manifest!.projectRoot).toBe("my-book-main");
    // Target paths stay relative to the project root, not the archive root.
    expect(manifest!.targets[0].source).toBe("source/main.ptx");
  });

  it("returns null for a file that is not really a manifest", () => {
    expect(
      parseProjectManifest("<pretext><book/></pretext>", "project.ptx"),
    ).toBeNull();
  });
});

describe("findProjectManifest", () => {
  it("prefers the shallowest manifest", () => {
    const manifest = findProjectManifest({
      "book/nested/project.ptx": V2,
      "book/project.ptx": V1,
    });
    expect(manifest!.manifestPath).toBe("book/project.ptx");
    expect(manifest!.projectRoot).toBe("book");
  });

  it("skips a project.ptx that has no <project> root", () => {
    const manifest = findProjectManifest({
      "project.ptx": "<pretext><article/></pretext>",
      "real/project.ptx": V2,
    });
    expect(manifest!.manifestPath).toBe("real/project.ptx");
  });

  it("returns null when there is no manifest", () => {
    expect(findProjectManifest({ "main.ptx": "<pretext/>" })).toBeNull();
  });
});

describe("defaultManifestTarget", () => {
  it("skips standalone targets while a real one exists", () => {
    const manifest = parseProjectManifest(
      `<project ptx-version="2"><targets>
         <target name="solo" format="html" source="solo.ptx" standalone="yes"/>
         <target name="web" format="html" source="main.ptx"/>
       </targets></project>`,
      "project.ptx",
    );
    expect(defaultManifestTarget(manifest!)!.name).toBe("web");
  });
});
