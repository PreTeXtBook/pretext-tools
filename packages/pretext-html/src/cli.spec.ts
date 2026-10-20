import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkAssetsFrom } from "./cli.js";

describe("linkAssetsFrom", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-cli-"));
    fs.mkdirSync(path.join(dir, "generated-assets", "latex-image"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(dir, "assets"));
    fs.mkdirSync(path.join(dir, "out"));
    fs.writeFileSync(
      path.join(dir, "generated-assets", "latex-image", "my fig.svg"),
      "<svg/>",
    );
    fs.writeFileSync(path.join(dir, "assets", "cat.png"), "");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const assetDirs = () => ({
    external: path.join(dir, "assets"),
    generated: path.join(dir, "generated-assets"),
  });

  it("links existing assets relative to the page", () => {
    const html = linkAssetsFrom(
      `<img src="generated/latex-image/my%20fig.svg"><img src="external/cat.png">`,
      assetDirs(),
      path.join(dir, "out"),
    );
    expect(html).toBe(
      `<img src="../generated-assets/latex-image/my%20fig.svg">` +
        `<img src="../assets/cat.png">`,
    );
  });

  it("shows a placeholder for an asset that is not there", () => {
    const html = linkAssetsFrom(
      `<img src="generated/prefigure/missing.svg">`,
      assetDirs(),
      path.join(dir, "out"),
    );
    expect(html).toContain("data:image/svg+xml,");
    expect(html).toContain("pretext generate prefigure");
  });

  it("shows a placeholder when no external directory is declared", () => {
    const html = linkAssetsFrom(
      `<img src="external/cat.png">`,
      { generated: path.join(dir, "generated-assets") },
      path.join(dir, "out"),
    );
    expect(html).toContain("data:image/svg+xml,");
  });
});
