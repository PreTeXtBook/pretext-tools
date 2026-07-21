import { describe, expect, it } from "vitest";
import {
  describeAsset,
  missingAssetPlaceholder,
  missingAssetSvg,
} from "./missing-asset.js";
import { rewriteAssetUrls } from "./assets.js";

describe("describeAsset", () => {
  it("names the producing tool for a generated asset", () => {
    // Under managed directories the first segment is both the tool and the
    // `pretext generate` target.
    expect(describeAsset("generated", "latex-image/fig-one.svg")).toEqual({
      kind: "generated",
      assetType: "latex-image",
      fileName: "fig-one.svg",
    });
    expect(describeAsset("generated", "sageplot/plot.svg").assetType).toBe(
      "sageplot",
    );
  });

  it("falls back when a generated path has no tool segment", () => {
    expect(describeAsset("generated", "legacy.svg").assetType).toBe(
      "generated",
    );
  });

  it("classifies external assets by extension", () => {
    expect(describeAsset("external", "kitten.PNG").assetType).toBe("image");
    expect(describeAsset("external", "clip.mp4").assetType).toBe("video");
    expect(describeAsset("external", "sound.wav").assetType).toBe("audio");
    expect(describeAsset("external", "notes.xyz").assetType).toBe("file");
  });

  it("uses the basename of a nested external path", () => {
    expect(describeAsset("external", "figs/deep/cat.png").fileName).toBe(
      "cat.png",
    );
  });
});

describe("missingAssetSvg", () => {
  it("tells a generated asset apart from an external one", () => {
    const generated = missingAssetSvg(
      describeAsset("generated", "latex-image/f.svg"),
    );
    expect(generated).toContain("Asset not generated yet");
    // The actionable part: the exact command that would produce it.
    expect(generated).toContain("pretext generate latex-image");

    const external = missingAssetSvg(describeAsset("external", "cat.png"));
    expect(external).toContain("External asset not found");
    expect(external).not.toContain("pretext generate");
  });

  it("carries a machine-readable marker for both kind and type", () => {
    // The hook for turning placeholders into buttons later.
    expect(
      missingAssetSvg(describeAsset("generated", "sageplot/p.svg")),
    ).toContain(`data-ptx-missing="generated:sageplot"`);
  });

  it("escapes XML-significant characters in a filename", () => {
    const svg = missingAssetSvg(describeAsset("external", `a&b<c>.png`));
    expect(svg).toContain("a&amp;b&lt;c&gt;.png");
  });

  it("truncates the visible filename but not the accessible name", () => {
    const longName = `${"x".repeat(120)}.png`;
    const svg = missingAssetSvg(describeAsset("external", longName));
    // Visible text is clipped so it cannot overflow the panel...
    const visible = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(
      (m) => m[1]!,
    );
    expect(visible.some((line) => line.includes("…"))).toBe(true);
    expect(visible.every((line) => !line.includes("x".repeat(60)))).toBe(true);
    // ...but the accessible name keeps the whole thing: it is never laid out,
    // and a screen reader user needs the actual filename to act on it.
    expect(svg).toContain(`aria-label="External asset not found: ${longName}"`);
  });
});

describe("missingAssetPlaceholder", () => {
  it("produces a data URI with no raw URI-breaking characters", () => {
    const uri = missingAssetPlaceholder("generated", "latex-image/f.svg");
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    const payload = uri.slice("data:image/svg+xml,".length);
    // A raw '#' would truncate the URI at a fragment; raw '"' would end the
    // HTML attribute the URI is dropped into.
    expect(payload).not.toContain("#");
    expect(payload).not.toContain('"');
    expect(payload).not.toContain("<");
  });

  it("keeps the marker greppable inside the encoded payload", () => {
    // Percent-encoding (not base64) is what makes the button hook findable.
    expect(missingAssetPlaceholder("external", "cat.png")).toContain(
      "data-ptx-missing",
    );
  });

  it("round-trips back to well-formed SVG", () => {
    const uri = missingAssetPlaceholder("generated", "asymptote/d.html");
    const decoded = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
    expect(decoded.startsWith("<svg")).toBe(true);
    expect(decoded.trimEnd().endsWith("</svg>")).toBe(true);
    expect(decoded).toContain("pretext generate asymptote");
  });

  it("survives the attribute escaping rewriteAssetUrls applies", () => {
    const html = rewriteAssetUrls(
      `<img src="generated/latex-image/f.svg">`,
      (kind, rel) => missingAssetPlaceholder(kind, rel),
    );
    // Exactly one src attribute, still properly quoted.
    expect(html.match(/src="/g)).toHaveLength(1);
    expect(html.endsWith(`">`)).toBe(true);
    expect(html).toContain("data-ptx-missing");
  });
});
