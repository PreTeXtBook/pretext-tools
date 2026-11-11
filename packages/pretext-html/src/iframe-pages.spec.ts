// The render tests run the real PreTeXt stylesheets in WASM, so the suite must
// be launched with JSPI enabled: `npm run test -w @pretextbook/pretext-html`.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embedIframePages, extractIframePages } from "./iframe-pages.js";
import { renderHtml } from "./renderer.js";

const carrier = (name: string, page: string) =>
  `<template data-ptx-iframe-page="${name}">${page}<!--/ptx-iframe-page--></template>`;

describe("extractIframePages", () => {
  it("lifts each page out and leaves the rest of the html as it was", () => {
    const { html, pages } = extractIframePages(
      `<p>a</p><iframe src="one-if.html"></iframe>` +
        carrier("one-if.html", "<html><body>1</body></html>") +
        `<p>b</p>` +
        carrier("two-if.html", "\n<html><body>2</body></html>\n") +
        `<p>c</p>`,
    );
    expect(html).toBe(
      `<p>a</p><iframe src="one-if.html"></iframe><p>b</p><p>c</p>`,
    );
    expect(pages).toEqual({
      "one-if.html": "<!DOCTYPE html>\n<html><body>1</body></html>\n",
      "two-if.html": "<!DOCTYPE html>\n<html><body>2</body></html>\n",
    });
  });

  it("ends a page at its closing comment, not at a template inside it", () => {
    const page = `<html><body><template id="t"><b>x</b></template></body></html>`;
    const { html, pages } = extractIframePages(carrier("a-if.html", page));
    expect(html).toBe("");
    expect(pages["a-if.html"]).toBe(`<!DOCTYPE html>\n${page}\n`);
  });

  it("returns html with no carriers unchanged", () => {
    const html = `<p><template id="mine">x</template></p>`;
    expect(extractIframePages(html)).toEqual({ html, pages: {} });
  });

  it("leaves a carrier that never closes where it is", () => {
    const html = `<p>a</p><template data-ptx-iframe-page="a-if.html"><html>`;
    expect(extractIframePages(html)).toEqual({ html, pages: {} });
  });
});

describe("embedIframePages", () => {
  const pages = {
    "a-if.html": `<!DOCTYPE html>\n<html><body class="x">1 &amp; 2</body></html>\n`,
  };

  it("gives the iframe its page as srcdoc, in place of the dead src", () => {
    const html = embedIframePages(
      `<iframe id="a" style="width:1px" src="a-if.html"></iframe>`,
      pages,
    );
    expect(html).toBe(
      `<iframe id="a" style="width:1px" data-ptx-iframe-page="a-if.html" ` +
        `srcdoc="&lt;!DOCTYPE html&gt;\n&lt;html&gt;&lt;body class=&quot;x&quot;&gt;` +
        `1 &amp;amp; 2&lt;/body&gt;&lt;/html&gt;\n"></iframe>`,
    );
  });

  it("sandboxes the iframe when asked", () => {
    const html = embedIframePages(`<iframe src="a-if.html"></iframe>`, pages, {
      sandbox: "allow-scripts",
    });
    expect(html).toContain(` sandbox="allow-scripts" srcdoc="`);
  });

  it("leaves iframes that name no page alone", () => {
    const html =
      `<iframe src="https://www.desmos.com/calculator/abc"></iframe>` +
      `<iframe src="b-if.html"></iframe><iframe name="x"></iframe>`;
    expect(embedIframePages(html, pages)).toBe(html);
  });

  it("does not mistake an inherited property name for a page", () => {
    const html = `<iframe src="constructor"></iframe>`;
    expect(embedIframePages(html, pages)).toBe(html);
  });
});

const INTERACTIVE_ARTICLE = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article xml:id="art">
    <title>Interactives</title>
    <section xml:id="sec">
      <title>One</title>
      <interactive xml:id="i-desmos" desmos="vbaz8kpyqq" width="80%" aspect="4:3"/>
      <interactive xml:id="i-ggb" geogebra="rmvbbvfu" width="80%" aspect="4:3"/>
      <interactive xml:id="i-jsx" platform="jsxgraph" width="80%" aspect="1:1" source="board.js">
        <slate xml:id="i-jsx-board" surface="jsxboard" aspect="1:1"/>
      </interactive>
      <interactive xml:id="i-js" platform="javascript" width="80%" aspect="1:1">
        <slate xml:id="i-js-canvas" surface="canvas" aspect="1:1"/>
        <script>const marker = 1 &lt; 2 &amp;&amp; "authored-script";</script>
      </interactive>
    </section>
  </article>
</pretext>
`;

const DESMOS_ARTICLE = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article xml:id="art">
    <title>Interactives</title>
    <interactive xml:id="i-desmos" desmos="vbaz8kpyqq" width="80%" aspect="4:3"/>
  </article>
</pretext>
`;

const INTERACTIVE_DECK = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <slideshow xml:id="deck">
    <title>Deck</title>
    <section xml:id="sec">
      <title>One</title>
      <slide xml:id="slide-one">
        <title>A slide</title>
        <interactive xml:id="i-jsx" platform="jsxgraph" width="80%" aspect="1:1" source="board.js">
          <slate xml:id="i-jsx-board" surface="jsxboard" aspect="1:1"/>
        </interactive>
      </slide>
    </section>
  </slideshow>
</pretext>
`;

describe("renderHtml iframe pages", () => {
  let dir: string;
  let sourcePath: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-iframe-"));
    sourcePath = path.join(dir, "main.ptx");
    fs.writeFileSync(sourcePath, INTERACTIVE_ARTICLE);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns a page for every interactive that needs one", async () => {
    const { html, iframePages } = await renderHtml({ sourcePath });
    // Exactly the interactives PreTeXt frames from a page of its own; Desmos
    // is framed straight from the service.
    expect(Object.keys(iframePages).sort()).toEqual([
      "i-ggb-if.html",
      "i-js-if.html",
      "i-jsx-if.html",
    ]);
    // Every page is named by an iframe on the main page, which carries none
    // of them itself.
    for (const name of Object.keys(iframePages)) {
      expect(html).toContain(`src="${name}"`);
    }
    expect(html).not.toContain("data-ptx-iframe-page");
    expect(html).not.toContain("ptx-iframe-page-->");
    expect(html).toContain(
      `src="https://www.desmos.com/calculator/vbaz8kpyqq"`,
    );
  }, 120000);

  it("builds each page as a complete document with the platform's code", async () => {
    const { iframePages } = await renderHtml({ sourcePath });
    for (const page of Object.values(iframePages)) {
      expect(page.startsWith("<!DOCTYPE html>\n")).toBe(true);
      expect(page).toMatch(/<html[^>]*>\s*<head>/);
      expect(page.trimEnd().endsWith("</html>")).toBe(true);
    }
    // GeoGebra: the applet's material and the library that deploys it.
    expect(iframePages["i-ggb-if.html"]).toContain("rmvbbvfu");
    expect(iframePages["i-ggb-if.html"]).toContain("deployggb.js");
    // JSXGraph: the library, the slate, and the author's @source file,
    // linked under external/ like any other asset.
    expect(iframePages["i-jsx-if.html"]).toContain("jsxgraph");
    expect(iframePages["i-jsx-if.html"]).toContain(`id="i-jsx-board"`);
    expect(iframePages["i-jsx-if.html"]).toContain(`src="external/board.js"`);
    // An authored script arrives as script, not as escaped text.
    expect(iframePages["i-js-if.html"]).toContain(
      `const marker = 1 < 2 && "authored-script";`,
    );
  }, 120000);

  it("keeps the page of an interactive on a slide", async () => {
    const { html, iframePages, target } = await renderHtml({
      sourcePath,
      sourceContent: INTERACTIVE_DECK,
    });
    expect(target).toBe("slides");
    expect(Object.keys(iframePages)).toEqual(["i-jsx-if.html"]);
    expect(html).toContain(`src="i-jsx-if.html"`);
    expect(html).not.toContain("data-ptx-iframe-page");
  }, 120000);

  it("returns no pages for a document without such interactives", async () => {
    const { iframePages } = await renderHtml({
      sourcePath,
      sourceContent: DESMOS_ARTICLE,
    });
    expect(iframePages).toEqual({});
  }, 120000);
});
