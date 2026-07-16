// Pure-JS tests for the source-map walk (no WASM involved). The contract
// with the real stylesheets — computed ids appearing in rendered HTML — is
// covered by the integration tests in renderer.spec.ts.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSourceMap, findSourceMapEntry } from "./sourcemap.js";
import { resolveXIncludesToTree } from "./xinclude.js";

describe("computeSourceMap", () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ptx-sourcemap-"));
    fs.writeFileSync(
      path.join(dir, "main.ptx"),
      `<?xml version="1.0" encoding="UTF-8"?>
<pretext xmlns:xi="http://www.w3.org/2001/XInclude">
  <article>
    <title>Map Test</title>
    <introduction>
      <p>First.</p>
      <p>Second.</p>
    </introduction>
    <xi:include href="section.ptx"/>
    <section>
      <title>Anonymous</title>
      <p>After the include.</p>
    </section>
  </article>
</pretext>
`,
    );
    fs.writeFileSync(
      path.join(dir, "section.ptx"),
      `<?xml version="1.0" encoding="UTF-8"?>
<section xml:id="sec-inc">
  <title>Included</title>
  <p>Included paragraph.</p>
</section>
`,
    );
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function mapOf() {
    const mainPath = path.join(dir, "main.ptx");
    const { tree } = await resolveXIncludesToTree(
      fs.readFileSync(mainPath, "utf8"),
      mainPath,
      dir,
    );
    return computeSourceMap(tree, mainPath);
  }

  it("replicates the assembly id walk, resetting at authored xml:ids", async () => {
    const map = await mapOf();
    const ids = map.map((entry) => entry.id);
    // pretext=root-1, article=root-1-1, title, introduction, its two <p>s
    expect(ids).toContain("root-1");
    expect(ids).toContain("root-1-1");
    expect(ids).toContain("root-1-1-2");
    expect(ids).toContain("root-1-1-2-1");
    expect(ids).toContain("root-1-1-2-2");
    // authored xml:id resets the chain; its children hang off it
    expect(ids).toContain("sec-inc");
    expect(ids).toContain("sec-inc-2");
    // the include occupies sibling position 3; the trailing section is 4
    expect(ids).toContain("root-1-1-4");
    expect(ids).toContain("root-1-1-4-2");
  });

  it("attributes included elements to their own file and lines", async () => {
    const map = await mapOf();
    const byId = new Map(map.map((entry) => [entry.id, entry]));
    const sectionFile = path.join(dir, "section.ptx");

    const included = byId.get("sec-inc");
    expect(included?.file).toBe(sectionFile);
    expect(included?.line).toBe(2); // <section> line in section.ptx
    const includedP = byId.get("sec-inc-2");
    expect(includedP?.file).toBe(sectionFile);
    expect(includedP?.line).toBe(4);

    // ...while elements after the include still map to main.ptx
    const after = byId.get("root-1-1-4");
    expect(after?.file).toBe(path.join(dir, "main.ptx"));
    expect(after?.line).toBe(10);
  });

  it("records parent links for outward fallback", async () => {
    const map = await mapOf();
    const byId = new Map(map.map((entry) => [entry.id, entry]));
    expect(byId.get("sec-inc-2")?.parent).toBe("sec-inc");
    expect(byId.get("sec-inc")?.parent).toBe("root-1-1");
    expect(byId.get("root-1")?.parent).toBe("root");
  });

  it("seats the walk below a fragment wrapper via parentId/position", async () => {
    const sectionPath = path.join(dir, "section.ptx");
    const { tree } = await resolveXIncludesToTree(
      fs.readFileSync(sectionPath, "utf8"),
      sectionPath,
      dir,
    );
    // Wrapper <pretext><article><title/>… → article is root-1-1, the
    // fragment root is its second element child.
    const map = computeSourceMap(tree, sectionPath, {
      parentId: "root-1-1",
      position: 2,
    });
    const byId = new Map(map.map((entry) => [entry.id, entry]));
    // xml:id still wins over the wrapper-derived id...
    expect(byId.get("sec-inc")?.parent).toBe("root-1-1");
    expect(byId.get("sec-inc-2")).toBeDefined();
    // ...and an id-less fragment root would have been root-1-1-2 (checked
    // against the real render in renderer.spec.ts).
  });
});

describe("findSourceMapEntry", () => {
  const entries = [
    { id: "a", file: "f", line: 2, column: 1, endLine: 20 },
    { id: "a-1", file: "f", line: 3, column: 3, endLine: 3 },
    { id: "a-2", file: "f", line: 5, column: 3, endLine: 9 },
    { id: "a-2-1", file: "f", line: 6, column: 5, endLine: 6 },
    { id: "a-3", file: "f", line: 11, column: 3, endLine: 14 },
  ];

  it("returns the nearest element starting at or before the line", () => {
    expect(findSourceMapEntry(entries, 6)?.id).toBe("a-2-1");
    expect(findSourceMapEntry(entries, 8)?.id).toBe("a-2-1");
    expect(findSourceMapEntry(entries, 10)?.id).toBe("a-2-1");
    expect(findSourceMapEntry(entries, 11)?.id).toBe("a-3");
    expect(findSourceMapEntry(entries, 100)?.id).toBe("a-3");
  });

  it("falls back to the first entry for a line in the prolog", () => {
    expect(findSourceMapEntry(entries, 1)?.id).toBe("a");
  });

  it("returns undefined for an empty map", () => {
    expect(findSourceMapEntry([], 5)).toBeUndefined();
  });
});
