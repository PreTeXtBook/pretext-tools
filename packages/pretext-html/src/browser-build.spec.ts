/**
 * End-to-end test of the browser build, without a browser.
 *
 * The browser bundle contains no `node:` imports and reaches the outside world
 * only through `fetch` against an assets base URL, so Node can execute it
 * directly: serving assets/ over local HTTP drives the exact code path a
 * browser takes. What this does *not* cover is the browser's own JSPI and
 * WASM implementations — for that a real browser is still required.
 *
 * Runs against dist/, so it needs `npm run build` first; it skips itself
 * (rather than failing) when the bundle is absent, so `vitest run` on a fresh
 * checkout stays green.
 */

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const browserBundle = path.join(packageDir, "dist/index.browser.js");
const hasBuild = existsSync(browserBundle);

const SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<section xml:id="sec-demo">
  <title>Instant Preview</title>
  <p>A paragraph with math <m>x^2</m>.</p>
  <theorem xml:id="thm-demo">
    <statement><p>Every division renders.</p></statement>
  </theorem>
</section>
`;

describe.skipIf(!hasBuild)("browser build", () => {
  // The browser bundle is loaded from dist/ at runtime, so its type comes from
  // the declarations the Node build emits rather than from a static import.
  type BrowserModule = typeof import("./index.browser.js");

  let server: Server;
  let base: string;
  let requests: string[];
  let mod: BrowserModule;

  beforeAll(async () => {
    requests = [];
    server = createServer(async (req, res) => {
      requests.push(req.url ?? "");
      try {
        const rel = decodeURIComponent(
          new URL(req.url ?? "", "http://x").pathname,
        );
        res
          .writeHead(200)
          .end(await readFile(path.join(packageDir, "assets", rel)));
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    base = `http://127.0.0.1:${port}`;

    mod = await import(browserBundle);
    mod.setAssetsBase(base);
  });

  afterAll(() => {
    server?.close();
  });

  it("renders a fragment with assets fetched over HTTP", async () => {
    const { html } = await mod.renderHtml({
      sourcePath: "/source/division.ptx",
      sourceContent: SOURCE,
      projectDir: "/source",
      fragment: true,
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Instant Preview");
    expect(html).toContain("thm-demo");
  });

  it("serves the whole stylesheet tree from the bundle in one request", () => {
    // The recorded bundle collapses ~32 stylesheet/localization reads into a
    // single fetch. Only preview-html.xsl (which lives above the xsl mount)
    // and the bundle itself should ever hit the network.
    expect(requests.toSorted()).toEqual([
      "/preview-html.xsl",
      "/xsl-bundle.json",
    ]);
  });

  it("falls back to per-file fetches when the bundle is unavailable", async () => {
    // Correctness must not depend on the bundle: point the assets base at a
    // location with no xsl-bundle.json and the render still has to succeed,
    // fetching each stylesheet individually.
    const noBundle = createServer(async (req, res) => {
      const rel = decodeURIComponent(
        new URL(req.url ?? "", "http://x").pathname,
      );
      if (rel === "/xsl-bundle.json") {
        res.writeHead(404).end("absent");
        return;
      }
      try {
        res
          .writeHead(200)
          .end(await readFile(path.join(packageDir, "assets", rel)));
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    await new Promise<void>((resolve) => noBundle.listen(0, resolve));
    const address = noBundle.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      mod.setAssetsBase(`http://127.0.0.1:${port}`);
      const { html } = await mod.renderHtml({
        sourcePath: "/source/division.ptx",
        sourceContent: SOURCE,
        projectDir: "/source",
        fragment: true,
      });
      expect(html).toContain("Instant Preview");
    } finally {
      noBundle.close();
      mod.setAssetsBase(base);
    }
  });

  it("reports a readable error when the assets base is wrong", async () => {
    mod.setAssetsBase("http://127.0.0.1:1/nowhere");
    try {
      await expect(
        mod.renderHtml({
          sourcePath: "/source/division.ptx",
          sourceContent: SOURCE,
          projectDir: "/source",
          fragment: true,
        }),
      ).rejects.toThrow(/preview-html\.xsl/);
    } finally {
      mod.setAssetsBase(base);
    }
  });
});
