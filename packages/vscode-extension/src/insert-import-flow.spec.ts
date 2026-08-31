import { describe, expect, it } from "vitest";
import { importProjectFromFiles } from "@pretextbook/import";
import {
  includeBlock,
  resolveAttachmentPoint,
  xiNamespaceInsertion,
} from "./insert-import-core";

// The two halves of an insert meet here: the editor decides the level and the
// position, the import package decides what the fragment becomes. The
// WorkspaceEdit that carries it is exercised by the integration suite; this
// composes the same pieces over plain strings so the seam between them is
// covered by a unit test.

const HOST = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article xml:id="notes">
    <title>Course Notes</title>
    <section xml:id="sec-intro">
      <title>Introduction</title>
      <p>Welcome.</p>
    </section>
    CURSOR
  </article>
</pretext>
`;

const HW_TEX = `\\documentclass{article}
\\begin{document}
\\section{Homework 3}
Prove that $n^2$ is even when $n$ is even.
\\end{document}`;

function insertInto(host: string, source: string, takenIds: string[] = []) {
  const offset = host.indexOf("CURSOR");
  const text = host.replace("CURSOR", "");
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  const character = offset - (before.lastIndexOf("\n") + 1);

  const attachment = resolveAttachmentPoint(text, line, character, offset);
  if (!attachment) {
    throw new Error("no attachment point");
  }

  const result = importProjectFromFiles(
    { "hw3.tex": source },
    {
      destination: {
        kind: "insert",
        targetTag: attachment.targetTag,
        takenIds: new Set(takenIds),
        hrefBase: "source/",
      },
    },
  );
  if ("pretextError" in result) {
    throw new Error(result.pretextError);
  }

  const lines = text.split("\n");
  lines.splice(
    attachment.line,
    0,
    includeBlock(attachment, result.insert?.includes ?? []).replace(/\n$/, ""),
  );
  let updated = lines.join("\n");
  const namespace = xiNamespaceInsertion(updated);
  if (namespace) {
    updated =
      updated.slice(0, namespace.offset) +
      namespace.attribute +
      updated.slice(namespace.offset);
  }
  return { attachment, result, updated };
}

describe("insert flow", () => {
  it("puts the include where the cursor was, at the cursor's own level", () => {
    // The cursor sits after </section>, so it is at article level: the import
    // becomes a sibling <section>, not a child of the section above it.
    const { attachment, updated } = insertInto(HOST, HW_TEX);
    expect(attachment.targetTag).toBe("section");
    expect(updated).toContain('    <xi:include href="sec-homework-3.ptx"/>\n');
    // Still inside the article, after the existing section.
    expect(updated.indexOf("</section>")).toBeLessThan(
      updated.indexOf("xi:include"),
    );
    expect(updated.indexOf("xi:include")).toBeLessThan(
      updated.indexOf("</article>"),
    );
  });

  it("declares the xi namespace on a document receiving its first include", () => {
    const { updated } = insertInto(HOST, HW_TEX);
    expect(updated).toContain(
      '<pretext xmlns:xi="http://www.w3.org/2001/XInclude">',
    );
  });

  it("writes the division to a file beside the host document", () => {
    const { result } = insertInto(HOST, HW_TEX);
    expect(Object.keys(result.outputFiles)).toEqual([
      "source/sec-homework-3.ptx",
    ]);
    expect(result.outputFiles["source/sec-homework-3.ptx"]).toContain(
      "<section",
    );
  });

  it("goes a level deeper when the cursor is inside a section", () => {
    const inside = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article xml:id="notes">
    <title>Course Notes</title>
    <section xml:id="sec-intro">
      <title>Introduction</title>
      <p>Welcome.</p>
      CURSOR
    </section>
  </article>
</pretext>
`;
    const { attachment, result, updated } = insertInto(inside, HW_TEX);
    expect(attachment.targetTag).toBe("subsection");
    expect(updated).toContain(
      '      <xi:include href="subsec-homework-3.ptx"/>',
    );
    expect(result.outputFiles["source/subsec-homework-3.ptx"]).toContain(
      "<subsection",
    );
  });

  it("keeps the host document's own ids", () => {
    const { result, updated } = insertInto(HOST, HW_TEX, [
      "notes",
      "sec-intro",
    ]);
    expect(updated).toContain('xml:id="sec-intro"');
    // Nothing in this import wanted those names, so nothing was renamed.
    expect(result.insert?.renamed).toEqual([]);
  });

  it("renames an imported id that would collide with the host", () => {
    const { result } = insertInto(
      HOST,
      `\\documentclass{article}
\\begin{document}
\\section{Introduction}\\label{sec-intro}
More on the same topic.
\\end{document}`,
      ["sec-intro"],
    );
    const renamed = result.insert?.renamed ?? [];
    expect(renamed.length).toBeGreaterThan(0);
    expect(renamed.every((r) => r.to !== "sec-intro")).toBe(true);
  });
});
