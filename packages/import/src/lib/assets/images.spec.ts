import { describe, expect, it } from "vitest";
import { importProjectFromFiles } from "../upload";
import { rewriteImageSources, routeImageAssets } from "./images";

describe("routeImageAssets", () => {
  it("flattens paths into the external directory", () => {
    const routed = routeImageAssets(
      ["figures/plot.png", "ch1/img/graph.jpg"],
      "source/",
    );
    expect(routed.pathByOriginal).toEqual({
      "figures/plot.png": "source/external/plot.png",
      "ch1/img/graph.jpg": "source/external/graph.jpg",
    });
  });

  it("honours a project's own external directory name", () => {
    const routed = routeImageAssets(["figs/plot.png"], "source/", "images");
    expect(routed.pathByOriginal["figs/plot.png"]).toBe(
      "source/images/plot.png",
    );
  });

  it("deduplicates names that collide once flattened", () => {
    const routed = routeImageAssets(
      ["ch1/plot.png", "ch2/plot.png", "ch3/plot.png"],
      "source/",
    );
    expect(Object.values(routed.pathByOriginal)).toEqual([
      "source/external/plot.png",
      "source/external/plot-2.png",
      "source/external/plot-3.png",
    ]);
  });

  it("maps a basename to the bare name a reference should use", () => {
    const routed = routeImageAssets(["figures/plot.png"], "source/");
    // `@source` is relative to the external directory, so no directory part.
    expect(routed.sourceByBaseName).toEqual({ "plot.png": "plot.png" });
  });
});

describe("rewriteImageSources", () => {
  const map = { "plot.png": "plot.png", "graph.jpg": "graph-2.jpg" };

  it("strips the archive's own directories from a reference", () => {
    const result = rewriteImageSources(
      `<image source="figures/plot.png" width="60%"/>`,
      map,
    );
    expect(result.source).toBe(`<image source="plot.png" width="60%"/>`);
    expect(result.rewritten).toEqual([
      { from: "figures/plot.png", to: "plot.png" },
    ]);
  });

  it("follows an image that was renamed to avoid a collision", () => {
    const result = rewriteImageSources(`<image source="b/graph.jpg"/>`, map);
    expect(result.source).toContain('source="graph-2.jpg"');
  });

  it("rewrites video and audio too", () => {
    const result = rewriteImageSources(
      `<video source="m/plot.png"/><audio source="a/plot.png"/>`,
      map,
    );
    expect(result.source).toBe(
      `<video source="plot.png"/><audio source="plot.png"/>`,
    );
  });

  it("leaves an absolute URL alone", () => {
    const url = `<image source="https://example.org/plot.png"/>`;
    expect(rewriteImageSources(url, map).source).toBe(url);
  });

  it("leaves a reference the upload cannot satisfy, and says so", () => {
    const result = rewriteImageSources(`<image source="missing.png"/>`, map);
    expect(result.source).toContain('source="missing.png"');
    expect(result.unresolved).toEqual(["missing.png"]);
  });

  it("does not touch a source attribute on some other element", () => {
    const other = `<program source="listing.py"/>`;
    expect(rewriteImageSources(other, { "listing.py": "x.py" }).source).toBe(
      other,
    );
  });

  it("preserves single quotes", () => {
    const result = rewriteImageSources(`<image source='f/plot.png'/>`, map);
    expect(result.source).toBe(`<image source='plot.png'/>`);
  });
});

describe("images through the pipeline", () => {
  const png = new Uint8Array([137, 80, 78, 71]);

  it("puts the file where the document now points", () => {
    const result = importProjectFromFiles(
      {
        "main.ptx": `<pretext><article xml:id="a"><title>A</title>
  <figure><image source="figures/plot.png"/></figure>
</article></pretext>`,
      },
      { assets: { "figures/plot.png": png } },
    );
    if ("pretextError" in result) {
      throw new Error(result.pretextError);
    }
    expect(result.outputAssets["source/external/plot.png"]).toEqual(png);
    expect(result.outputFiles["source/main.ptx"]).toContain(
      'source="plot.png"',
    );
    expect(result.outputFiles["source/main.ptx"]).not.toContain("figures/");
  });

  it("rewrites references in every file the split produced", () => {
    const result = importProjectFromFiles(
      {
        "main.ptx": `<pretext><article xml:id="a"><title>A</title>
  <section xml:id="s1"><title>One</title><image source="figs/plot.png"/></section>
  <section xml:id="s2"><title>Two</title><image source="figs/graph.png"/></section>
</article></pretext>`,
      },
      {
        splitLevel: 1,
        assets: { "figs/plot.png": png, "figs/graph.png": png },
      },
    );
    if ("pretextError" in result) {
      throw new Error(result.pretextError);
    }
    expect(result.outputFiles["source/sec-s1.ptx"]).toContain(
      'source="plot.png"',
    );
    expect(result.outputFiles["source/sec-s2.ptx"]).toContain(
      'source="graph.png"',
    );
  });

  it("warns about an image the document names but the upload lacks", () => {
    const result = importProjectFromFiles({
      "main.ptx": `<pretext><article xml:id="a"><title>A</title>
  <figure><image source="missing.png"/></figure>
</article></pretext>`,
    });
    if ("pretextError" in result) {
      throw new Error(result.pretextError);
    }
    expect(result.warnings.some((w) => w.category === "missing_image")).toBe(
      true,
    );
  });

  it("routes into a host project's own external directory for an insert", () => {
    const result = importProjectFromFiles(
      {
        "hw.ptx": `<pretext><article xml:id="hw"><title>HW</title>
  <figure><image source="figures/plot.png"/></figure>
</article></pretext>`,
      },
      {
        assets: { "figures/plot.png": png },
        externalDir: "images",
        destination: {
          kind: "insert",
          targetTag: "subsection",
          takenIds: new Set<string>(),
          hrefBase: "source/",
        },
      },
    );
    if ("pretextError" in result) {
      throw new Error(result.pretextError);
    }
    expect(result.outputAssets["source/images/plot.png"]).toEqual(png);
    expect(result.outputFiles["source/subsec-hw.ptx"]).toContain(
      'source="plot.png"',
    );
  });
});
