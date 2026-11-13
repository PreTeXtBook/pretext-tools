// The renderSnippet tests run the real PreTeXt stylesheets in WASM, so the
// suite must be launched with JSPI enabled: `npm run test -w
// @pretextbook/pretext-html`.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseArgs } from "./cli.js";
import { isJspiAvailable } from "./renderer.js";
import { extractSnippet, renderSnippet } from "./snippet.js";

describe("extractSnippet", () => {
  const page = (inner: string) =>
    `<html><body><div id="latex-macros" class="hidden-content process-math" style="display:none">\\(\\newcommand{\\R}{\\mathbb R}\\)</div>` +
    `<header>masthead</header><main><div class="ptx-content">${inner}</div></main><footer>f</footer></body></html>`;

  it("returns the wrapper section's content and the macros", () => {
    const { html, latexMacros } = extractSnippet(
      page(`<section class="article" id="snippet">\n<p>hi</p>\n</section>`),
      "snippet",
    );
    expect(html).toBe("<p>hi</p>");
    expect(latexMacros).toContain("\\newcommand{\\R}");
    expect(latexMacros).toMatch(/^<div\b[\s\S]*<\/div>$/);
  });

  it("drops the wrapper's own permalink but keeps the content's", () => {
    const keep = `<div class="autopermalink" aria-hidden="true"><a href="#s-2">🔗</a></div>`;
    const { html } = extractSnippet(
      `<section id="s"><p>a</p>${keep}<div class="autopermalink" aria-hidden="true" data-description="Article: "><a tabindex="-1" href="#s" title="t">🔗</a></div>\n</section>`,
      "s",
    );
    expect(html).toBe(`<p>a</p>${keep}`);
  });

  it("keeps sections nested inside the snippet", () => {
    const { html } = extractSnippet(
      page(
        `<section id="s" class="article"><p>a</p><section id="s-1"><section id="s-1-1">x</section></section><p>b</p></section><section id="other">no</section>`,
      ),
      "s",
    );
    expect(html).toBe(
      `<p>a</p><section id="s-1"><section id="s-1-1">x</section></section><p>b</p>`,
    );
  });

  it("does not match an id that merely starts with the prefix", () => {
    const { html } = extractSnippet(
      page(`<section id="s-2">no</section><section id="s">yes</section>`),
      "s",
    );
    expect(html).toBe("yes");
  });

  it("reports no macros when the page has none", () => {
    expect(extractSnippet(`<section id="s">x</section>`, "s").latexMacros).toBe(
      "",
    );
  });

  it("throws when the snippet is not on the page", () => {
    expect(() => extractSnippet(page("<p>x</p>"), "snippet")).toThrow(
      /Could not find the snippet/,
    );
  });
});

describe("renderSnippet", () => {
  let dir: string;

  beforeAll(() => {
    expect(
      isJspiAvailable(),
      "JSPI must be enabled; run tests via `npm run test -w @pretextbook/pretext-html`",
    ).toBe(true);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-snippet-"));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("renders a paragraph and a theorem without the page around them", async () => {
    const { html } = await renderSnippet({
      content: `<p>Hello <m>x^2</m>.</p>
<theorem><statement><p>All is well.</p></statement></theorem>`,
    });
    expect(html).toContain('class="para"');
    expect(html).toContain("Hello");
    expect(html).toContain("\\(x^2");
    expect(html).toContain("theorem-like");
    expect(html).toContain("All is well.");
    for (const chrome of [
      "ptx-masthead",
      "ptx-toc",
      "ptx-content-footer",
      "ptx-page-footer",
      "<head",
      "<body",
      "<html",
      "<main",
      'class="article"',
    ]) {
      expect(html).not.toContain(chrome);
    }
    // The untitled wrapper emits no heading of its own: the first thing is
    // the paragraph.
    expect(html).toMatch(/^<div class="para"/);
    expect(html).not.toContain(`href="#snippet"`);
  });

  it("prefixes generated ids with idPrefix", async () => {
    const { html } = await renderSnippet({
      content: `<p>One.</p><p>Two.</p>`,
      idPrefix: "demo",
    });
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.startsWith("demo")).toBe(true);
  });

  it("renders plain text", async () => {
    const { html } = await renderSnippet({ content: "<p>Just text.</p>" });
    expect(html).toContain("Just text.");
  });

  it("carries the docinfo's LaTeX macros", async () => {
    const { latexMacros, html } = await renderSnippet({
      content: `<p><m>\\R</m></p>`,
      docinfo: `<docinfo><macros>\\newcommand{\\R}{\\mathbb R}</macros></docinfo>`,
    });
    expect(latexMacros).toContain("\\newcommand{\\R}");
    expect(html).not.toContain("latex-macros");
  });

  it("lifts the docinfo from a main file", async () => {
    const main = path.join(dir, "main.ptx");
    fs.writeFileSync(
      main,
      `<pretext><docinfo><macros>\\newcommand{\\Q}{\\mathbb Q}</macros></docinfo><article><p/></article></pretext>`,
    );
    const { latexMacros } = await renderSnippet({
      content: `<p><m>\\Q</m></p>`,
      sourcePath: path.join(dir, "snippet.ptx"),
      docinfoSourcePath: main,
    });
    expect(latexMacros).toContain("\\newcommand{\\Q}");
  });

  it("resolves xi:includes relative to sourcePath", async () => {
    fs.writeFileSync(
      path.join(dir, "included.ptx"),
      `<p xml:id="from-include">Included paragraph.</p>`,
    );
    const { html } = await renderSnippet({
      content: `<p>Before.</p><xi:include href="included.ptx"/>`,
      sourcePath: path.join(dir, "snippet.ptx"),
    });
    expect(html).toContain("Before.");
    expect(html).toContain("Included paragraph.");
  });

  it("rejects an idPrefix that is not an XML name", async () => {
    await expect(
      renderSnippet({ content: "<p/>", idPrefix: "1 bad" }),
    ).rejects.toThrow(/Invalid snippet idPrefix/);
  });
});

describe("pretext-html --snippet", () => {
  it("parses --snippet and --snippet-id", () => {
    const args = parseArgs(["--snippet", "--snippet-id", "ex", "s.ptx"]);
    expect(args.snippet).toBe(true);
    expect(args.snippetId).toBe("ex");
    expect(args.options.sourcePath).toBe("s.ptx");
  });

  it("leaves snippet mode off by default", () => {
    expect(parseArgs(["main.ptx"]).snippet).toBeUndefined();
  });

  it("rejects options that only apply to documents", () => {
    expect(() =>
      parseArgs(["--snippet", "--context", "main.ptx", "s.ptx"]),
    ).toThrow(/--snippet cannot be combined with --context/);
    expect(() => parseArgs(["--snippet", "--fragment", "s.ptx"])).toThrow(
      /--fragment/,
    );
  });

  it("requires --snippet for --snippet-id", () => {
    expect(() => parseArgs(["--snippet-id", "x", "s.ptx"])).toThrow(
      /--snippet-id needs --snippet/,
    );
  });
});
