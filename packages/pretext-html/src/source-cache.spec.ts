import { describe, expect, it } from "vitest";
import { toXml } from "xast-util-to-xml";
import { cloneTree, SourceCache } from "./source-cache.js";
import type { Element } from "xast";

describe("SourceCache", () => {
  it("parses once per distinct content and counts hits", () => {
    const cache = new SourceCache();
    cache.parse("/a.ptx", "<a><b/></a>");
    cache.parse("/a.ptx", "<a><b/></a>");
    cache.parse("/a.ptx", "<a><b/><c/></a>");
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(2);
    expect(cache.size).toBe(1);
  });

  it("hands out copies, so mutating one does not poison the next", () => {
    const cache = new SourceCache();
    const first = cache.parse("/a.ptx", "<a><b>text</b></a>");
    const root = first.children[0] as Element;
    root.children = [];
    root.attributes["xml:id"] = "mutated";
    const second = cache.parse("/a.ptx", "<a><b>text</b></a>");
    expect(cache.hits).toBe(1);
    expect(toXml(second)).toBe("<a><b>text</b></a>");
  });

  it("keeps positions on the copies", () => {
    const cache = new SourceCache();
    cache.parse("/a.ptx", "<a>\n<b/></a>");
    const copy = cache.parse("/a.ptx", "<a>\n<b/></a>");
    const b = (copy.children[0] as Element).children[1] as Element;
    expect(b.position?.start.line).toBe(2);
  });

  it("evicts the least recently used file past maxEntries", () => {
    const cache = new SourceCache({ maxEntries: 2 });
    cache.parse("/a.ptx", "<a/>");
    cache.parse("/b.ptx", "<b/>");
    cache.parse("/a.ptx", "<a/>"); // touch a, so b is the oldest
    cache.parse("/c.ptx", "<c/>");
    expect(cache.size).toBe(2);
    cache.parse("/b.ptx", "<b/>");
    expect(cache.misses).toBe(4);
    cache.parse("/a.ptx", "<a/>");
    expect(cache.misses).toBe(5); // a was evicted when b came back
  });

  it("caches nothing for malformed content", () => {
    const cache = new SourceCache();
    expect(() => cache.parse("/a.ptx", "<a>")).toThrow();
    expect(cache.size).toBe(0);
  });

  it("invalidates one file or all", () => {
    const cache = new SourceCache();
    cache.parse("/a.ptx", "<a/>");
    cache.parse("/b.ptx", "<b/>");
    cache.invalidate("/a.ptx");
    expect(cache.size).toBe(1);
    cache.invalidate();
    expect(cache.size).toBe(0);
  });
});

describe("cloneTree", () => {
  it("copies attributes, children and data but shares positions", () => {
    const cache = new SourceCache();
    const tree = cache.parse("/a.ptx", `<a x="1"><b/></a>`);
    const root = tree.children[0] as Element;
    root.data = { tag: "yes" };
    const copy = cloneTree(tree);
    const copyRoot = copy.children[0] as Element;
    expect(copyRoot).not.toBe(root);
    expect(copyRoot.attributes).not.toBe(root.attributes);
    expect(copyRoot.attributes).toEqual(root.attributes);
    expect(copyRoot.children[0]).not.toBe(root.children[0]);
    expect(copyRoot.data).not.toBe(root.data);
    expect(copyRoot.data).toEqual(root.data);
    expect(copyRoot.position).toBe(root.position);
  });
});
