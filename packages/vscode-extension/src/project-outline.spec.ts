import { describe, it, expect } from "vitest";
import * as path from "path";
import { parseProjectOutline } from "./project-outline";

// Build absolute keys the same way the module resolves hrefs, so the test is
// platform-independent (path.resolve adds the drive/root for the current OS).
const ROOT = path.resolve("/proj/source");
const abs = (rel: string) => path.resolve(ROOT, rel);
const reader =
  (files: Record<string, string>) =>
  async (p: string): Promise<string | undefined> =>
    p in files ? files[p] : undefined;

describe("parseProjectOutline", () => {
  it("splices included files in place and annotates each item with its file", async () => {
    const files = {
      [abs("main.ptx")]:
        '<book><title>B</title>\n<xi:include href="ch1.ptx"/>\n</book>',
      [abs("ch1.ptx")]:
        '<chapter><title>One</title>\n<xi:include href="sec1.ptx"/>\n</chapter>',
      [abs("sec1.ptx")]: "<section><title>Sec</title></section>",
    };
    const roots = await parseProjectOutline(abs("main.ptx"), reader(files));

    expect(roots.map((r) => r.tag)).toEqual(["book"]);
    const book = roots[0];
    expect(book.file).toBe(abs("main.ptx"));

    const chapter = book.children[0];
    expect(chapter.tag).toBe("chapter");
    expect(chapter.title).toBe("One");
    expect(chapter.file).toBe(abs("ch1.ptx"));

    const section = chapter.children[0];
    expect(section.title).toBe("Sec");
    expect(section.file).toBe(abs("sec1.ptx"));
  });

  it("keeps multiple includes in document order", async () => {
    const files = {
      [abs("main.ptx")]:
        '<book>\n<xi:include href="a.ptx"/>\n<xi:include href="b.ptx"/>\n</book>',
      [abs("a.ptx")]: "<chapter><title>A</title></chapter>",
      [abs("b.ptx")]: "<chapter><title>B</title></chapter>",
    };
    const roots = await parseProjectOutline(abs("main.ptx"), reader(files));
    expect(roots[0].children.map((c) => c.title)).toEqual(["A", "B"]);
  });

  it("renders an unreadable include as a (missing) leaf in its parent file", async () => {
    const files = {
      [abs("main.ptx")]: '<book>\n<xi:include href="gone.ptx"/>\n</book>',
    };
    const roots = await parseProjectOutline(abs("main.ptx"), reader(files));
    const child = roots[0].children[0];
    expect(child.tag).toBe("missing");
    expect(child.title).toBe("(missing: gone.ptx)");
    expect(child.file).toBe(abs("main.ptx"));
  });

  it("breaks include cycles instead of looping forever", async () => {
    const files = {
      [abs("main.ptx")]: '<book>\n<xi:include href="loop.ptx"/>\n</book>',
      [abs("loop.ptx")]:
        '<chapter><title>Loop</title>\n<xi:include href="main.ptx"/>\n</chapter>',
    };
    const roots = await parseProjectOutline(abs("main.ptx"), reader(files));
    const chapter = roots[0].children[0];
    expect(chapter.title).toBe("Loop");
    // The re-include of main.ptx is dropped, so there is no infinite nesting.
    expect(chapter.children).toEqual([]);
  });

  it("returns a (missing) root when the entry file itself is unreadable", async () => {
    const roots = await parseProjectOutline(abs("nope.ptx"), reader({}));
    expect(roots).toHaveLength(1);
    expect(roots[0].tag).toBe("missing");
  });
});
