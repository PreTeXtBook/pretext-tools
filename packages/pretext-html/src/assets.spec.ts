import { describe, expect, it, vi } from "vitest";
import { rewriteAssetUrls } from "./assets.js";
import { fromXml } from "xast-util-from-xml";
import {
  docinfoExternalDirectory,
  readAssetDirectories,
} from "./publication.js";

describe("readAssetDirectories", () => {
  it("defaults to the minimal publication's directories", () => {
    expect(readAssetDirectories()).toEqual({
      external: "../assets/",
      generated: "../generated-assets/",
    });
  });

  it("adds a trailing slash when the publication omits one", () => {
    const dirs = readAssetDirectories(
      `<publication><source><directories external="img" generated="gen"/></source></publication>`,
    );
    expect(dirs).toEqual({ external: "img/", generated: "gen/" });
  });

  it("defaults the generated directory and declares no external one", () => {
    // Managed directories are PreTeXt's only scheme now: the generated
    // directory is machine-owned and defaultable, and an undeclared external
    // directory means the project has no external assets.
    const dirs = readAssetDirectories(
      `<publication><html><platform portable="yes"/></html></publication>`,
    );
    expect(dirs).toEqual({ generated: "generated/" });
  });

  it("reads either directory on its own", () => {
    expect(
      readAssetDirectories(
        `<publication><source><directories generated="gen"/></source></publication>`,
      ),
    ).toEqual({ generated: "gen/" });
    expect(
      readAssetDirectories(
        `<publication><source><directories external="img"/></source></publication>`,
      ),
    ).toEqual({ external: "img/", generated: "generated/" });
  });

  it("prefers the docinfo's external directory to the publication's", () => {
    const dirs = readAssetDirectories(
      `<publication><source><directories external="old" generated="gen"/></source></publication>`,
      "media",
    );
    expect(dirs).toEqual({ external: "media/", generated: "gen/" });
  });

  it("rejects an absolute path, as publisher-variables.xsl does", () => {
    const dirs = readAssetDirectories(
      `<publication><source><directories external="/abs" generated="/gen"/></source></publication>`,
    );
    expect(dirs.external).toBeUndefined();
    expect(dirs.generated).toBe("generated/");
  });
});

describe("docinfoExternalDirectory", () => {
  it("reads the docinfo of a whole document", () => {
    const tree = fromXml(
      `<pretext><docinfo><directories external="media" data="d"/></docinfo>` +
        `<article/></pretext>`,
    );
    expect(docinfoExternalDirectory(tree)).toBe("media");
  });

  it("reads a docinfo on its own, parsed or as a string", () => {
    const docinfo = `<docinfo><directories external="pics"/></docinfo>`;
    expect(docinfoExternalDirectory(docinfo)).toBe("pics");
    expect(docinfoExternalDirectory(fromXml(docinfo))).toBe("pics");
  });

  it("declares nothing when the docinfo does not say", () => {
    expect(
      docinfoExternalDirectory(fromXml(`<pretext><article/></pretext>`)),
    ).toBeUndefined();
    expect(
      docinfoExternalDirectory(`<docinfo><directories data="d"/></docinfo>`),
    ).toBeUndefined();
    expect(docinfoExternalDirectory("<docinfo>")).toBeUndefined();
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
