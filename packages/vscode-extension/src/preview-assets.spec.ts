import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  assetVersion,
  assetWatchGlob,
  isInside,
  isInsideAny,
  watchedAssetDirs,
} from "./preview-assets";

const project = path.resolve("/work/book");
const inProject = (...parts: string[]) => path.join(project, ...parts);

describe("assetVersion", () => {
  it("changes when the file is rewritten", () => {
    const before = assetVersion({ mtimeMs: 1729441234567.25, size: 2048 });
    const after = assetVersion({ mtimeMs: 1729441299999.5, size: 2048 });
    expect(before).not.toBe(after);
  });

  it("changes when only the size does", () => {
    expect(assetVersion({ mtimeMs: 10, size: 1 })).not.toBe(
      assetVersion({ mtimeMs: 10, size: 2 }),
    );
  });

  it("uses only characters a URI query keeps unencoded", () => {
    expect(assetVersion({ mtimeMs: 1729441234567.25, size: 2048 })).toMatch(
      /^[0-9-]+$/,
    );
  });
});

describe("isInside", () => {
  it("accepts the directory itself and anything below it", () => {
    expect(isInside(inProject("gen"), inProject("gen"))).toBe(true);
    expect(
      isInside(inProject("gen", "latex-image", "a.svg"), inProject("gen")),
    ).toBe(true);
  });

  it("rejects siblings, including ones sharing a prefix", () => {
    expect(
      isInside(inProject("generated-old", "a.svg"), inProject("generated")),
    ).toBe(false);
    expect(isInside(inProject("assets", "a.png"), inProject("gen"))).toBe(
      false,
    );
  });

  it("checks every directory given", () => {
    const dirs = [inProject("gen"), inProject("assets")];
    expect(isInsideAny(inProject("assets", "cat.png"), dirs)).toBe(true);
    expect(isInsideAny(inProject("output", "index.html"), dirs)).toBe(false);
  });
});

describe("watchedAssetDirs", () => {
  it("watches both directories when both are in the project", () => {
    expect(
      watchedAssetDirs(
        {
          generated: inProject("generated-assets"),
          external: inProject("assets"),
        },
        project,
      ),
    ).toEqual([inProject("generated-assets"), inProject("assets")]);
  });

  it("skips an undeclared external directory", () => {
    expect(watchedAssetDirs({ generated: inProject("gen") }, project)).toEqual([
      inProject("gen"),
    ]);
  });

  it("skips directories outside the project, which are never linked", () => {
    expect(
      watchedAssetDirs(
        {
          generated: path.resolve("/elsewhere/gen"),
          external: inProject("media"),
        },
        project,
      ),
    ).toEqual([inProject("media")]);
  });

  it("watches a directory once when both names resolve to it", () => {
    expect(
      watchedAssetDirs(
        { generated: inProject("assets"), external: inProject("assets") },
        project,
      ),
    ).toEqual([inProject("assets")]);
  });
});

describe("assetWatchGlob", () => {
  it("matches everything below the directory, relative to the project", () => {
    expect(assetWatchGlob(project, inProject("generated-assets"))).toBe(
      "generated-assets/**",
    );
    expect(assetWatchGlob(project, inProject("source", "media"))).toBe(
      "source/media/**",
    );
  });

  it("falls back to the whole project for a name glob syntax cannot spell", () => {
    expect(assetWatchGlob(project, inProject("figs [old]"))).toBe("**");
    expect(assetWatchGlob(project, inProject("{gen}"))).toBe("**");
  });

  it("watches the whole project when the directory is the project", () => {
    expect(assetWatchGlob(project, project)).toBe("**");
  });
});
