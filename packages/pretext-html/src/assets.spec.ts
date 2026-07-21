import { describe, expect, it, vi } from "vitest";
import { rewriteAssetUrls } from "./assets.js";
import { readAssetDirectories } from "./publication.js";

describe("readAssetDirectories", () => {
  it("defaults to the minimal publication's directories", () => {
    expect(readAssetDirectories()).toEqual({
      external: "../assets/",
      generated: "../generated-assets/",
      managed: true,
    });
  });

  it("adds a trailing slash when the publication omits one", () => {
    const dirs = readAssetDirectories(
      `<publication><source><directories external="img" generated="gen"/></source></publication>`,
    );
    expect(dirs).toEqual({
      external: "img/",
      generated: "gen/",
      managed: true,
    });
  });

  it("is unmanaged when the publication declares neither directory", () => {
    const dirs = readAssetDirectories(
      `<publication><html><platform portable="yes"/></html></publication>`,
    );
    expect(dirs.managed).toBe(false);
  });

  it("is unmanaged when only one directory is declared", () => {
    // PreTeXt warns and proceeds as if neither was given; matching that keeps
    // the preview from rewriting URLs the stylesheets never emitted.
    const dirs = readAssetDirectories(
      `<publication><source><directories external="img"/></source></publication>`,
    );
    expect(dirs.managed).toBe(false);
  });

  it("rejects an absolute path, as publisher-variables.xsl does", () => {
    const dirs = readAssetDirectories(
      `<publication><source><directories external="/abs" generated="gen"/></source></publication>`,
    );
    expect(dirs.external).toBeUndefined();
    expect(dirs.managed).toBe(false);
  });
});

describe("rewriteAssetUrls", () => {
  const resolve = (kind: string, rel: string) => `vscode://${kind}/${rel}`;

  it("rewrites both asset directories", () => {
    const html = rewriteAssetUrls(
      `<img src="external/kitten.png"><img src="generated/sageplot/p.svg">`,
      resolve,
    );
    expect(html).toBe(
      `<img src="vscode://external/kitten.png">` +
        `<img src="vscode://generated/sageplot/p.svg">`,
    );
  });

  it("rewrites media and iframes, not just images", () => {
    // <video>, <audio> and asymptote's 3d <iframe> all use src.
    expect(rewriteAssetUrls(`<video src="external/m.mp4">`, resolve)).toContain(
      `src="vscode://external/m.mp4"`,
    );
  });

  it("leaves absolute URLs that merely contain a prefix alone", () => {
    const html = `<img src="https://cdn.example.com/external/logo.png">`;
    expect(rewriteAssetUrls(html, resolve)).toBe(html);
  });

  it("leaves unrelated relative URLs alone", () => {
    const html = `<img src="images/legacy.png"><script src="app.js">`;
    expect(rewriteAssetUrls(html, resolve)).toBe(html);
  });

  it("keeps the original URL when the resolver declines", () => {
    const html = `<img src="external/missing.png">`;
    expect(rewriteAssetUrls(html, () => undefined)).toBe(html);
  });

  it("percent-decodes the path handed to the resolver", () => {
    const seen = vi.fn(() => "ok:");
    rewriteAssetUrls(`<img src="external/my%20cat.png">`, seen);
    expect(seen).toHaveBeenCalledWith("external", "my cat.png");
  });

  it("escapes the resolved URL for attribute context", () => {
    const html = rewriteAssetUrls(
      `<img src="external/a.png">`,
      () => `x://y?a=1&b="2"`,
    );
    expect(html).toBe(`<img src="x://y?a=1&amp;b=&quot;2&quot;">`);
  });
});
