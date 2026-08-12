// These tests run the real PreTeXt stylesheets in WASM, so the suite must be
// launched with JSPI enabled: `npm run test -w @pretextbook/pretext-html`
// (which runs vitest under `node --experimental-wasm-jspi`).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isJspiAvailable, renderHtml, xpathStringLiteral } from "./renderer.js";
import { forcePortablePublication } from "./publication.js";
import {
  HTML_STATIC_VERSION,
  RUNESTONE_CSS,
  RUNESTONE_JS,
  RUNESTONE_VERSION,
} from "./html-static.js";

const SIMPLE_ARTICLE = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article xml:id="test-article">
    <title>Test Article</title>
    <introduction>
      <p>Some <em>emphasized</em> text and inline math <m>a^2 + b^2 = c^2</m>.</p>
    </introduction>
    <section xml:id="sec-one">
      <title>One Section</title>
      <theorem xml:id="thm-test">
        <title>Test Theorem</title>
        <statement><p>All <term>tests</term> shall pass.</p></statement>
        <proof><p>By construction; see <xref ref="thm-test"/>.</p></proof>
      </theorem>
    </section>
  </article>
</pretext>
`;

// One of each kind of "printout" — the divisions upstream puts a print-preview
// button on the heading of. The preview wrapper disables those buttons; see
// PRINTOUT_LINK_OVERRIDE in scripts/refresh-xsl.mjs.
const PRINTOUT_ARTICLE = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article xml:id="printout-article">
    <title>Printouts</title>
    <worksheet xml:id="ws-one">
      <title>A Worksheet</title>
      <page>
        <exercise><statement><p>Work it out.</p></statement></exercise>
      </page>
    </worksheet>
    <handout xml:id="handout-one">
      <title>A Handout</title>
      <page><p>Hand it out.</p></page>
    </handout>
  </article>
</pretext>
`;

// Two of Runestone's interactive exercises. The stylesheets render these as
// inert markup (`data-component="..."`) that only becomes an exercise once the
// Runestone Services bundle runs, so both halves have to be checked.
const RUNESTONE_ARTICLE = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article xml:id="runestone-article">
    <title>Runestone</title>
    <section xml:id="runestone-section">
      <title>Interactives</title>
      <exercise xml:id="rs-choice">
        <statement><p>Which is even?</p></statement>
        <choices>
          <choice correct="yes"><statement><p>2</p></statement></choice>
          <choice><statement><p>3</p></statement></choice>
        </choices>
      </exercise>
      <exercise xml:id="rs-parsons">
        <statement><p>Arrange the blocks.</p></statement>
        <blocks>
          <block><p>First</p></block>
          <block><p>Second</p></block>
        </blocks>
      </exercise>
    </section>
  </article>
</pretext>
`;

// An exercise whose hint and solution are born hidden (PreTeXt hides those
// automatically), plus a footnote — the other kind of <details>, which the
// preview leaves collapsed. See knowls.ts.
const KNOWL_ARTICLE = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article xml:id="knowl-article">
    <title>Knowls</title>
    <section xml:id="knowl-section">
      <title>A Section</title>
      <p>Text with a footnote<fn>The footnote body.</fn>.</p>
      <exercise xml:id="knowl-exercise">
        <statement><p>Compute something.</p></statement>
        <hint><p>Start here.</p></hint>
        <solution><p>The answer is 42.</p></solution>
      </exercise>
    </section>
  </article>
</pretext>
`;

describe("xpathStringLiteral", () => {
  it("quotes plain strings with single quotes", () => {
    expect(xpathStringLiteral("hello")).toBe("'hello'");
  });
  it("uses double quotes when value has single quotes", () => {
    expect(xpathStringLiteral("it's")).toBe(`"it's"`);
  });
  it("uses concat when value has both quote characters", () => {
    expect(xpathStringLiteral(`a'b"c`)).toBe(`concat('a', "'", 'b"c')`);
  });
});

describe("forcePortablePublication", () => {
  it("synthesizes a minimal publication file", () => {
    const xml = forcePortablePublication();
    expect(xml).toContain("<publication>");
    expect(xml).toContain('portable="yes"');
  });
  it("forces portable on an existing publication file", () => {
    const xml = forcePortablePublication(
      `<publication><html><platform portable="no" host="web"/></html></publication>`,
    );
    expect(xml).toContain('portable="yes"');
    expect(xml).toContain('host="web"');
  });
  it("adds html/platform elements when missing", () => {
    const xml = forcePortablePublication(
      `<publication><source><directories external="ext" generated="gen"/></source></publication>`,
    );
    expect(xml).toContain('portable="yes"');
    expect(xml).toContain('external="ext"');
  });

  describe("css theme", () => {
    it("declares the theme in a synthesized publication file", () => {
      const xml = forcePortablePublication(undefined, { cssTheme: "denver" });
      expect(xml).toContain('<css theme="denver"');
      expect(xml).toContain('portable="yes"');
      // The synthesized file's asset directories must survive the rewrite.
      expect(xml).toContain('external="../assets"');
    });

    it("declares the theme when the publication file has no <css>", () => {
      const xml = forcePortablePublication(
        `<publication><html><platform host="web"/></html></publication>`,
        { cssTheme: "tacoma" },
      );
      expect(xml).toContain('<css theme="tacoma"');
      expect(xml).toContain('host="web"');
    });

    it("adds the theme to an existing <css> that names none", () => {
      const xml = forcePortablePublication(
        `<publication><html><css colors="blue_red"/></html></publication>`,
        { cssTheme: "salem" },
      );
      expect(xml).toContain('colors="blue_red"');
      expect(xml).toContain('theme="salem"');
      // Added as an attribute of the existing element, not a second <css>.
      expect(xml.match(/<css\b/g)).toHaveLength(1);
    });

    it("leaves a publication file that already names a theme alone", () => {
      const xml = forcePortablePublication(
        `<publication><html><css theme="denver"/></html></publication>`,
        { cssTheme: "tacoma" },
      );
      expect(xml).toContain('theme="denver"');
      expect(xml).not.toContain("tacoma");
    });

    it.each(["style", "shell"])(
      "leaves a legacy @%s style alone",
      (attribute) => {
        const xml = forcePortablePublication(
          `<publication><html><css ${attribute}="crc"/></html></publication>`,
          { cssTheme: "tacoma" },
        );
        expect(xml).toContain(`${attribute}="crc"`);
        expect(xml).not.toContain("theme=");
      },
    );

    it("ignores a blank theme", () => {
      const xml = forcePortablePublication(
        `<publication><html/></publication>`,
        { cssTheme: "   " },
      );
      expect(xml).not.toContain("<css");
    });

    it("leaves the publication file untouched when no theme is given", () => {
      expect(forcePortablePublication()).toBe(forcePortablePublication());
      expect(forcePortablePublication()).not.toContain("<css");
    });
  });
});

describe("forcePortablePublication reveal.js resources", () => {
  const slides = { target: "slides" } as const;

  it("declares the CDN host for a synthesized publication file", () => {
    const xml = forcePortablePublication(undefined, slides);
    expect(xml).toContain('host="cdn"');
    expect(xml).toContain('portable="yes"');
  });

  it.each(["local", "embedded"])(
    "overrides an unusable @host of %s",
    (host) => {
      const xml = forcePortablePublication(
        `<publication><revealjs><resources host="${host}"/></revealjs></publication>`,
        slides,
      );
      expect(xml).toContain('host="cdn"');
      expect(xml).not.toContain(`host="${host}"`);
    },
  );

  it("forces online mathematics, which needs no prebuilt SVG", () => {
    const xml = forcePortablePublication(
      `<publication><revealjs><resources host="embedded" math="embedded"/></revealjs></publication>`,
      slides,
    );
    expect(xml).toContain('math="online"');
    expect(xml).not.toContain('math="embedded"');
  });

  it("leaves the author's reveal theme and navigation alone", () => {
    const xml = forcePortablePublication(
      `<publication><revealjs><appearance theme="moon"/><navigation mode="linear"/></revealjs></publication>`,
      { ...slides, revealTheme: "black" },
    );
    expect(xml).toContain('theme="moon"');
    expect(xml).toContain('mode="linear"');
    expect(xml).not.toContain("black");
  });

  it("supplies a fallback reveal theme when the project names none", () => {
    const xml = forcePortablePublication(undefined, {
      ...slides,
      revealTheme: "black",
    });
    expect(xml).toContain('<appearance theme="black"');
  });

  it("touches nothing reveal-related for an ordinary HTML render", () => {
    expect(forcePortablePublication()).not.toContain("revealjs");
  });
});

describe("renderHtml", () => {
  let projectDir: string;

  beforeAll(() => {
    expect(
      isJspiAvailable(),
      "JSPI must be enabled; run tests via `npm run test -w @pretextbook/pretext-html`",
    ).toBe(true);

    // A little project with an xi:include and a publication file.
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-test-"));
    fs.mkdirSync(path.join(projectDir, "source"));
    fs.writeFileSync(
      path.join(projectDir, "source", "main.ptx"),
      `<?xml version="1.0" encoding="UTF-8"?>
<pretext xmlns:xi="http://www.w3.org/2001/XInclude">
  <article xml:id="inc-article">
    <title>Included Article</title>
    <xi:include href="section.ptx"/>
  </article>
</pretext>
`,
    );
    fs.writeFileSync(
      path.join(projectDir, "source", "section.ptx"),
      `<?xml version="1.0" encoding="UTF-8"?>
<section xml:id="sec-included">
  <title>Included Section</title>
  <p>Content from an included file.</p>
</section>
`,
    );
    fs.writeFileSync(
      path.join(projectDir, "publication.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>
<publication>
  <html>
    <platform portable="no"/>
  </html>
</publication>
`,
    );
  });

  afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("renders a simple article to a complete standalone page", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-simple-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, SIMPLE_ARTICLE);
      const { html } = await renderHtml({ sourcePath });

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Test Article");
      // content rendered
      expect(html).toContain('<em class="emphasis">emphasized</em>');
      expect(html).toContain('<dfn class="terminology">tests</dfn>');
      // math delegated to MathJax
      expect(html).toContain("a^2 + b^2 = c^2");
      expect(html).toContain("MathJax");
      // portable mode: assets from CDN, page structure present
      expect(html).toContain("cdn.jsdelivr.net");
      expect(html).toContain('id="ptx-content"');
      // MathJax import fixup applied: no `./https://` module specifiers
      expect(html).not.toContain("'./https://");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("renders unsaved content passed as sourceContent", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-unsaved-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, SIMPLE_ARTICLE);
      const { html } = await renderHtml({
        sourcePath,
        sourceContent: SIMPLE_ARTICLE.replace(
          "Test Article",
          "Edited Unsaved Title",
        ),
      });
      expect(html).toContain("Edited Unsaved Title");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shows the print-preview buttons on printouts, but inert", async () => {
    const { html } = await renderHtml({
      sourcePath: path.join(projectDir, "source", "main.ptx"),
      projectDir,
      sourceContent: PRINTOUT_ARTICLE,
    });
    // Both printouts still show a button, so the preview does not
    // misrepresent the built page...
    expect(html.match(/class="print-links"/g)).toHaveLength(2);
    expect(html.match(/class="print-link"/g)).toHaveLength(2);
    // ...but it navigates nowhere: no @href at all, hence no query parameter
    // for a host to resolve against the wrong URL.
    expect(html).not.toContain("printpreview");
    expect(html).not.toMatch(/<a[^>]*class="print-link"[^>]*href=/);
    expect(html).toMatch(/<a class="print-link"[^>]*aria-disabled="true"/);
  });

  it("expands born-hidden knowls so preview edits are visible", async () => {
    const { html } = await renderHtml({
      sourcePath: path.join(projectDir, "source", "main.ptx"),
      projectDir,
      sourceContent: KNOWL_ARTICLE,
    });
    // The hint and the solution are born hidden; both are open.
    expect(html).toMatch(
      /<details open [^>]*class="hint solution-like born-hidden-knowl"/,
    );
    expect(html).toMatch(
      /<details open [^>]*class="solution solution-like born-hidden-knowl"/,
    );
    // Every born-hidden knowl on the page, and no <details> that is not one.
    const opened = html.match(/<details open\b/g) ?? [];
    expect(opened).toHaveLength(
      (html.match(/class="[^"]*born-hidden-knowl/g) ?? []).length,
    );
    // The footnote keeps the built page's collapsed behaviour.
    expect(html).toMatch(/<details class="ptx-footnote"/);
  });

  it("leaves knowls collapsed when openKnowls is off", async () => {
    const { html } = await renderHtml({
      sourcePath: path.join(projectDir, "source", "main.ptx"),
      projectDir,
      sourceContent: KNOWL_ARTICLE,
      openKnowls: false,
    });
    expect(html).toContain("born-hidden-knowl");
    expect(html).not.toContain("<details open");
  });

  it("injects the preview banner when previewBanner is given", async () => {
    const { html } = await renderHtml({
      sourcePath: path.join(projectDir, "source", "main.ptx"),
      projectDir,
      sourceContent: SIMPLE_ARTICLE,
      previewBanner: { message: "This is only a live preview." },
    });
    expect(html).toContain("This is only a live preview.");
    expect(html).toContain('id="ptx-preview-banner"');
    // Ahead of PreTeXt's own masthead, not buried inside the page content.
    expect(html.indexOf("ptx-preview-banner")).toBeLessThan(
      html.indexOf("ptx-masthead"),
    );
  });

  it("omits the preview banner when previewBanner is not given", async () => {
    const { html } = await renderHtml({
      sourcePath: path.join(projectDir, "source", "main.ptx"),
      projectDir,
      sourceContent: SIMPLE_ARTICLE,
    });
    expect(html).not.toContain("ptx-preview-banner");
  });

  it("resolves xi:include and respects the publication file", async () => {
    const { html } = await renderHtml({
      sourcePath: path.join(projectDir, "source", "main.ptx"),
      projectDir,
      publicationPath: path.join(projectDir, "publication.xml"),
    });
    expect(html).toContain("Content from an included file");
    // portable was forced despite the publication file saying "no"
    expect(html).toContain("cdn.jsdelivr.net");
    // no cssTheme given, so PreTeXt's own default applies
    expect(html).toContain("theme-default-modern.min.css");
  });

  it("themes the page from cssTheme", async () => {
    const { html } = await renderHtml({
      sourcePath: path.join(projectDir, "source", "main.ptx"),
      projectDir,
      // Declares no theme of its own, so the caller's default applies.
      publicationPath: path.join(projectDir, "publication.xml"),
      cssTheme: "tacoma",
    });
    // Portable builds name the theme in the CDN stylesheet URL.
    expect(html).toContain("theme-tacoma.min.css");
  });

  it("passes extra string parameters through to the stylesheet", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-params-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, SIMPLE_ARTICLE);
      // cli.version selects the pinned CDN asset version, visible in the head
      const { html } = await renderHtml({
        sourcePath,
        stringParams: { "cli.version": "2.20" },
      });
      expect(html).toContain("html-static@2.20");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("links the Runestone Services bundle so interactives can run", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-rs-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, RUNESTONE_ARTICLE);
      const { html } = await renderHtml({ sourcePath });

      // The exercises' own markup, which is inert on its own...
      expect(html).toContain('data-component="multiplechoice"');
      expect(html).toContain('data-component="parsons"');
      // ...and the bundle that gives it behaviour, from the release its
      // content-hashed filenames belong to (see html-static.ts).
      for (const file of [...RUNESTONE_JS, ...RUNESTONE_CSS]) {
        expect(html).toContain(
          `cdn.jsdelivr.net/gh/PreTeXtBook/html-static@${HTML_STATIC_VERSION}/dist/_static/${file}`,
        );
      }
      // Client-side components in an ordinary web build: the exercises run in
      // the reader's browser, with no Runestone server behind them.
      expect(html).toContain("eBookConfig.useRunestoneServices = false");
      expect(html).toContain(
        `eBookConfig.runestone_version = '${RUNESTONE_VERSION}'`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets a caller drop the Runestone Services bundle", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-rs-off-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, RUNESTONE_ARTICLE);
      const { html } = await renderHtml({
        sourcePath,
        stringParams: { "rs-js": "", "rs-css": "" },
      });
      for (const file of [...RUNESTONE_JS, ...RUNESTONE_CSS]) {
        expect(html).not.toContain(file);
      }
      // The exercises are still built, just left without their behaviour.
      expect(html).toContain('data-component="multiplechoice"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a source file outside the project directory", async () => {
    await expect(
      renderHtml({
        sourcePath: path.join(projectDir, "source", "main.ptx"),
        projectDir: path.join(projectDir, "source", "deeper-nonexistent"),
      }),
    ).rejects.toThrow(/must live inside/);
  });

  it("throws a useful error on malformed source", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-bad-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, "<pretext><article>unclosed");
      await expect(renderHtml({ sourcePath })).rejects.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an xi:included fragment instead of emitting an empty page", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-frag-"));
    try {
      const sourcePath = path.join(dir, "ch-intro.ptx");
      fs.writeFileSync(
        sourcePath,
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<!-- a chapter pulled in via xi:include -->\n` +
          `<chapter xml:id="ch-intro"><title>Intro</title>` +
          `<p>Fragment content.</p></chapter>\n`,
      );
      await expect(renderHtml({ sourcePath })).rejects.toThrow(
        /root is <chapter>.*fragment/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wraps a section fragment in an article in fragment mode", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-fsec-"));
    try {
      const sourcePath = path.join(dir, "sec-one.ptx");
      fs.writeFileSync(
        sourcePath,
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<section xml:id="sec-one"><title>Lonely Section</title>` +
          `<p>Some math: <m>x^2</m> and an <em>emphasis</em>.</p></section>\n`,
      );
      const { html } = await renderHtml({ sourcePath, fragment: true });
      expect(html).toContain("</html>");
      expect(html).toContain("Lonely Section");
      expect(html).toContain("emphasis");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wraps a chapter fragment in a book in fragment mode", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-fch-"));
    try {
      const sourcePath = path.join(dir, "ch-intro.ptx");
      fs.writeFileSync(
        sourcePath,
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<chapter xml:id="ch-intro"><title>Intro Chapter</title>` +
          `<section xml:id="sec-a"><title>First Section</title>` +
          `<p>Chapter fragment content.</p></section></chapter>\n`,
      );
      const { html } = await renderHtml({ sourcePath, fragment: true });
      expect(html).toContain("</html>");
      expect(html).toContain("Intro Chapter");
      expect(html).toContain("First Section");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injects a supplied docinfo into a fragment wrapper", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-fdi-"));
    try {
      const sourcePath = path.join(dir, "sec-macro.ptx");
      fs.writeFileSync(
        sourcePath,
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<section xml:id="sec-macro"><title>Macro Section</title>` +
          `<p>Math with a custom macro: <m>\\uniquefragmacro</m>.</p></section>\n`,
      );
      const { html } = await renderHtml({
        sourcePath,
        fragment: true,
        docinfo:
          `<docinfo>\n` +
          `  <macros>\\newcommand{\\uniquefragmacro}{Z}</macros>\n` +
          `</docinfo>`,
      });
      expect(html).toContain("</html>");
      // PreTeXt emits the docinfo macros into the page for MathJax; if the
      // wrapper had dropped docinfo, the macro would be absent.
      expect(html).toContain("uniquefragmacro");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a source map whose ids appear in the rendered HTML", async () => {
    const { html, sourceMap } = await renderHtml({
      sourcePath: path.join(projectDir, "source", "main.ptx"),
      projectDir,
      publicationPath: path.join(projectDir, "publication.xml"),
      sourceMap: true,
    });
    expect(sourceMap).toBeDefined();
    const byId = new Map(sourceMap!.map((entry) => [entry.id, entry]));

    // Authored xml:ids pass through...
    expect(html).toContain('id="inc-article"');
    expect(byId.get("inc-article")?.file).toBe(
      path.join(projectDir, "source", "main.ptx"),
    );
    // ...and auto-generated assembly ids match the page exactly. The <p>
    // inside the included section is its second element child (after
    // <title>), so its id hangs off the section's xml:id.
    expect(html).toContain('id="sec-included-2"');
    const includedP = byId.get("sec-included-2");
    expect(includedP?.file).toBe(
      path.join(projectDir, "source", "section.ptx"),
    );
    expect(includedP?.line).toBe(4);
    expect(includedP?.parent).toBe("sec-included");
  });

  it("maps a wrapped fragment with the wrapper id prefix", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-fmap-"));
    try {
      const sourcePath = path.join(dir, "sec-frag.ptx");
      fs.writeFileSync(
        sourcePath,
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<section xml:id="sec-frag"><title>Frag</title>` +
          `<p>Mapped paragraph.</p></section>\n`,
      );
      const { html, sourceMap } = await renderHtml({
        sourcePath,
        fragment: true,
        sourceMap: true,
      });
      const byId = new Map(sourceMap!.map((entry) => [entry.id, entry]));
      // Fragment root keeps its xml:id, parented on the synthesized wrapper
      // <article> (root-1-1), whose id really is in the page.
      expect(byId.get("sec-frag")?.parent).toBe("root-1-1");
      expect(html).toContain('id="root-1-1"');
      // The fragment's own auto ids match the page too.
      expect(html).toContain('id="sec-frag-2"');
      expect(byId.get("sec-frag-2")?.file).toBe(sourcePath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lifts an xi:included docinfo from the main file for a fragment", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-fdis-"));
    try {
      fs.mkdirSync(path.join(dir, "source"));
      // main.ptx pulls docinfo in via xi:include (the common author pattern),
      // and docinfo.ptx factors its macros out into yet another include.
      fs.writeFileSync(
        path.join(dir, "source", "main.ptx"),
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<pretext xmlns:xi="http://www.w3.org/2001/XInclude">\n` +
          `  <xi:include href="docinfo.ptx"/>\n` +
          `  <book xml:id="bk"><title>Bk</title>\n` +
          `    <xi:include href="ch1.ptx"/>\n` +
          `  </book>\n</pretext>\n`,
      );
      fs.writeFileSync(
        path.join(dir, "source", "docinfo.ptx"),
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<docinfo xmlns:xi="http://www.w3.org/2001/XInclude">\n` +
          `  <xi:include href="macros.ptx"/>\n</docinfo>\n`,
      );
      fs.writeFileSync(
        path.join(dir, "source", "macros.ptx"),
        `<macros>\\newcommand{\\uniquefragmacro}{Z}</macros>\n`,
      );
      // A missing chapter include would break a full merge — proving we only
      // read the docinfo, never the book's chapters.
      const fragmentPath = path.join(dir, "source", "sec-macro.ptx");
      fs.writeFileSync(
        fragmentPath,
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<section xml:id="sec-macro"><title>Macro Section</title>` +
          `<p>Uses <m>\\uniquefragmacro</m>.</p></section>\n`,
      );
      const { html } = await renderHtml({
        sourcePath: fragmentPath,
        projectDir: dir,
        fragment: true,
        docinfoSourcePath: path.join(dir, "source", "main.ptx"),
      });
      expect(html).toContain("</html>");
      expect(html).toContain("uniquefragmacro");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Builds a project whose generated SVG lives at the path a real PreTeXt
   * build would use, with the fragment nested one directory below the main
   * file — the arrangement that used to anchor `document()` on the wrong
   * directory and silently produce an empty <svg>.
   */
  function makeAssetProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-asset-"));
    fs.mkdirSync(path.join(dir, "source", "chapters"), { recursive: true });
    fs.mkdirSync(path.join(dir, "generated-assets", "latex-image"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(dir, "publication.xml"),
      `<publication><source>` +
        `<directories external="../assets" generated="../generated-assets"/>` +
        `</source></publication>\n`,
    );
    fs.writeFileSync(
      path.join(dir, "source", "main.ptx"),
      `<pretext><article xml:id="a"><title>A</title></article></pretext>\n`,
    );
    fs.writeFileSync(
      path.join(dir, "generated-assets", "latex-image", "img-one.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"` +
        ` viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"` +
        ` fill="rebeccapurple"/></svg>\n`,
    );
    fs.writeFileSync(
      path.join(dir, "source", "chapters", "sec.ptx"),
      `<section xml:id="sec"><title>S</title>` +
        `<image xml:id="img-one"><latex-image>\\draw (0,0);</latex-image></image>` +
        `<image xml:id="img-two" source="cat.png"/></section>\n`,
    );
    return dir;
  }

  it("inlines a generated SVG for a fragment below the main source dir", async () => {
    const dir = makeAssetProject();
    try {
      const { html } = await renderHtml({
        sourcePath: path.join(dir, "source", "chapters", "sec.ptx"),
        mainSourcePath: path.join(dir, "source", "main.ptx"),
        projectDir: dir,
        publicationPath: path.join(dir, "publication.xml"),
        fragment: true,
      });
      // The SVG's contents are copied into the page, not linked.
      expect(html).toContain("rebeccapurple");
      // An empty viewBox is the signature of a document() that read nothing.
      expect(html).not.toContain(`viewBox="0 0  "`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports the asset directories the page's URLs refer to", async () => {
    const dir = makeAssetProject();
    try {
      const result = await renderHtml({
        sourcePath: path.join(dir, "source", "chapters", "sec.ptx"),
        mainSourcePath: path.join(dir, "source", "main.ptx"),
        projectDir: dir,
        publicationPath: path.join(dir, "publication.xml"),
        fragment: true,
      });
      // Resolved against the *main* file's directory, so both land at the
      // project root rather than under source/chapters/.
      expect(result.assetDirs).toEqual({
        external: path.join(dir, "assets"),
        generated: path.join(dir, "generated-assets"),
      });
      // The author-supplied image is still a link, and carries the fixed
      // prefix rewriteAssetUrls keys on.
      expect(result.html).toContain(`src="external/cat.png"`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("omits assetDirs for a publication with no declared directories", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-nodir-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, SIMPLE_ARTICLE);
      fs.writeFileSync(
        path.join(dir, "publication.xml"),
        `<publication><html><platform portable="yes"/></html></publication>\n`,
      );
      const result = await renderHtml({
        sourcePath,
        projectDir: dir,
        publicationPath: path.join(dir, "publication.xml"),
      });
      expect(result.assetDirs).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a complete document unchanged in fragment mode", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-fdoc-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, SIMPLE_ARTICLE);
      const { html } = await renderHtml({ sourcePath, fragment: true });
      expect(html).toContain("Test Article");
      expect(html).toContain("</html>");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renderHtml slideshows", () => {
  const DECK = `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <docinfo><macros>\\newcommand{\\R}{\\mathbb{R}}</macros></docinfo>
  <slideshow xml:id="deck">
    <title>Test Deck</title>
    <section xml:id="sec-first">
      <title>First Section</title>
      <slide xml:id="slide-a">
        <title>Slide A</title>
        <p>Some math <m>x \\in \\R</m>.</p>
      </slide>
    </section>
    <slide xml:id="slide-b"><title>Slide B</title><p>Text.</p></slide>
  </slideshow>
</pretext>
`;

  /** Render `source` in a throwaway directory. */
  async function renderDeck(
    source: string,
    options: Partial<Parameters<typeof renderHtml>[0]> = {},
  ) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-deck-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, source);
      return await renderHtml({ sourcePath, ...options });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("detects a slideshow and builds a reveal.js deck", async () => {
    const { html, target } = await renderDeck(DECK);
    expect(target).toBe("slides");
    expect(html).toContain('<div class="reveal');
    expect(html).toContain("Reveal.initialize({");
    expect(html).toContain("Slide A");
    // The document's macros still reach the deck's mathematics.
    expect(html).toContain("\\mathbb{R}");
  }, 120000);

  it("loads every resource from a CDN, including the slide stylesheet", async () => {
    const { html } = await renderDeck(DECK);
    expect(html).toContain("cdn.jsdelivr.net/npm/reveal.js");
    // The _static fixup: upstream emits this one as a bare relative path,
    // which would 404 and cost the deck all of its PreTeXt styling.
    expect(html).toContain(
      `cdn.jsdelivr.net/gh/PreTeXtBook/html-static@${HTML_STATIC_VERSION}/dist/_static/pretext/css/pretext-reveal.css`,
    );
    expect(html).not.toMatch(/href="_static\//);
  }, 120000);

  it("opens in the scroll view by default", async () => {
    const { html } = await renderDeck(DECK);
    expect(html).toContain('"view":"scroll"');
  }, 120000);

  it("honours an explicit presentation view", async () => {
    const { html } = await renderDeck(DECK, { revealView: "slides" });
    expect(html).toContain('"view":null');
  }, 120000);

  it("overrides the deck's percentage size so reveal scales to fit", async () => {
    // PreTeXt publishes width/height of "100%", which reveal resolves to the
    // pane itself — scale 1, and theme text far larger than it should be.
    const { html } = await renderDeck(DECK);
    expect(html).toContain('width: "100%"'); // the deck still asks for it…
    expect(html).toContain('"width":960'); // …and the bridge overrides it.
  }, 120000);

  it("zooms out by enlarging the slide, so overflowing content is readable", async () => {
    const { html } = await renderDeck(DECK, { revealZoom: 0.5 });
    expect(html).toContain('"width":1920');
    expect(html).toContain('"height":1400');
  }, 120000);

  it("stamps ids on slides and sections for editor sync", async () => {
    const { html } = await renderDeck(DECK);
    // Upstream emits bare <section> elements; the preview wrapper adds the
    // @unique-id, which is what a source-map lookup resolves to.
    expect(html).toContain('<section id="slide-a"');
    expect(html).toContain('<section id="slide-b"');
    expect(html).toContain('<section id="sec-first"');
  }, 120000);

  it("maps slide ids back to their source lines", async () => {
    const { sourceMap } = await renderDeck(DECK, { sourceMap: true });
    const slide = sourceMap?.find((entry) => entry.id === "slide-a");
    expect(slide).toBeDefined();
    // The id is in the page and the map agrees where it came from, which is
    // the whole contract editor↔preview sync rests on.
    expect(slide?.line).toBe(
      DECK.split("\n").findIndex((l) => l.includes('<slide xml:id="slide-a"')) +
        1,
    );
  }, 120000);

  it("does not inject the light/dark bridge, which a deck cannot use", async () => {
    // A deck loads no pretext-core.js, so there is no setDarkMode to call.
    const { html } = await renderDeck(DECK, { theme: "dark" });
    expect(html).not.toContain("setDarkMode");
  }, 120000);

  it("overrides a publication file that hosts reveal.js locally", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-local-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, DECK);
      const publicationPath = path.join(dir, "publication.xml");
      fs.writeFileSync(
        publicationPath,
        `<?xml version="1.0" encoding="UTF-8"?>
<publication><revealjs><resources host="local"/></revealjs></publication>
`,
      );
      const { html } = await renderHtml({ sourcePath, publicationPath });
      // "local" resolves $reveal-root to ".", i.e. "./reveal.css" — nothing
      // the preview can serve.
      expect(html).toContain("cdn.jsdelivr.net/npm/reveal.js");
      expect(html).not.toMatch(/href="\.\/reveal\.css"/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("uses the fallback reveal theme only when the project names none", async () => {
    const { html } = await renderDeck(DECK, { revealTheme: "black" });
    expect(html).toContain("reveal.js@6/dist/theme/black.css");
  }, 120000);

  it("builds a deck from a lone slide in fragment mode", async () => {
    // Wrapped in <slideshow>, not <article>: the reveal entry template only
    // descends into a slideshow, so the wrong wrapper yields a blank page.
    const { html, target } = await renderDeck(
      `<slide xml:id="lonely"><title>Lonely Slide</title><p>Alone.</p></slide>`,
      { fragment: true },
    );
    expect(target).toBe("slides");
    expect(html).toContain("Lonely Slide");
    expect(html).toContain('<div class="reveal');
  }, 120000);

  it("still renders an ordinary document as HTML", async () => {
    // The detection must not have made every render a slideshow.
    const { html, target } = await renderDeck(SIMPLE_ARTICLE);
    expect(target).toBe("html");
    expect(html).toContain('id="ptx-content"');
    expect(html).not.toContain("Reveal.initialize");
  }, 120000);
});

describe("concurrent renders", () => {
  // Renders share one compiled stylesheet, a patched globalThis.fetch and the
  // mount tables, and the transform suspends mid-run to fetch stylesheets — so
  // overlapping renders used to interleave inside libxslt and corrupt it. The
  // corruption did not report itself as such: it surfaced as an out-of-bounds
  // memory fault (long mapped to "the document is too large", whatever its
  // actual size), after which the WASM instance aborted on every later call
  // for the rest of the process. renderHtml now queues instead.
  //
  // These deliberately run against the same module instance as the tests
  // above: under the old behaviour the corruption would take them down too,
  // which is exactly the regression worth catching.

  function writeSource(dir: string, body: string): string {
    const sourcePath = path.join(dir, "main.ptx");
    fs.writeFileSync(sourcePath, body);
    return sourcePath;
  }

  it("survives overlapping renders and returns every result", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-conc-"));
    try {
      const sources = [1, 2, 3, 4].map((n) => {
        const sub = path.join(dir, `r${n}`);
        fs.mkdirSync(sub);
        return writeSource(
          sub,
          SIMPLE_ARTICLE.replace("Test Article", `Doc ${n}`),
        );
      });

      const results = await Promise.all(
        sources.map((sourcePath) => renderHtml({ sourcePath })),
      );

      results.forEach(({ html }, index) => {
        expect(html).toContain(`Doc ${index + 1}`);
        expect(html).toContain("</html>");
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the queue usable after a render rejects", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-qfail-"));
    try {
      const bad = writeSource(dir, "<pretext><article>unclosed");
      const goodDir = path.join(dir, "good");
      fs.mkdirSync(goodDir);
      const good = writeSource(goodDir, SIMPLE_ARTICLE);

      // A doomed render queued alongside a sound one must neither stall the
      // queue nor poison what follows it.
      const settled = await Promise.allSettled([
        renderHtml({ sourcePath: bad }),
        renderHtml({ sourcePath: good }),
      ]);
      expect(settled[1]?.status).toBe("fulfilled");

      const { html } = await renderHtml({ sourcePath: good });
      expect(html).toContain("Test Article");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Rendering a fragment in the context of its document (contextSourcePath).
 *
 * The point of the mode is that the fragment is numbered, and its
 * cross-references resolved, exactly as the built book would do it — so each
 * test here compares against what the whole document produces, rather than
 * against a hard-coded number that would not show a drift for what it is.
 */
describe("renderHtml in document context", () => {
  let dir: string;
  let mainPath: string;
  let sectionPath: string;

  // Two chapters. The previewed section is 2.1; it references a theorem in
  // chapter 1, which a standalone fragment render cannot see at all.
  const MAIN = `<?xml version="1.0" encoding="UTF-8"?>
<pretext xmlns:xi="http://www.w3.org/2001/XInclude">
  <docinfo><macros>\\newcommand{\\Zed}{\\mathbb{Z}}</macros></docinfo>
  <book xml:id="ctx-book">
    <title>Context Book</title>
    <chapter xml:id="ctx-ch1">
      <title>First Chapter</title>
      <section xml:id="ctx-s11">
        <title>Early Section</title>
        <theorem xml:id="ctx-far"><title>Far Theorem</title>
          <statement><p>Distinctive far prose.</p></statement></theorem>
      </section>
    </chapter>
    <chapter xml:id="ctx-ch2">
      <title>Second Chapter</title>
      <xi:include href="section.ptx"/>
    </chapter>
  </book>
</pretext>
`;

  const SECTION = `<?xml version="1.0" encoding="UTF-8"?>
<section xml:id="ctx-s21">
  <title>Previewed Section</title>
  <theorem xml:id="ctx-near"><title>Near Theorem</title>
    <statement><p>Uses <m>\\Zed</m>.</p></statement></theorem>
  <p>Refers to <xref ref="ctx-far"/> and to <xref ref="ctx-near"/>.</p>
</section>
`;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-ctx-"));
    mainPath = path.join(dir, "main.ptx");
    sectionPath = path.join(dir, "section.ptx");
    fs.writeFileSync(mainPath, MAIN);
    fs.writeFileSync(sectionPath, SECTION);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("numbers the fragment as the whole document does", async () => {
    const { html } = await renderHtml({
      sourcePath: sectionPath,
      fragment: true,
      contextSourcePath: mainPath,
    });
    // Chapter 2, first section, first block.
    expect(html).toContain("2.1.1");
    // The standalone wrapper would restart at 1.1 and never mention 2.1.
    expect(html).toContain("Previewed Section");
  });

  it("resolves a cross-reference leaving the fragment", async () => {
    const { html } = await renderHtml({
      sourcePath: sectionPath,
      fragment: true,
      contextSourcePath: mainPath,
    });
    expect(html).not.toContain("cross-reference to target");
    // The far theorem is numbered from its real position, not guessed at.
    expect(html).toContain("Theorem 1.1.1");
  });

  it("emits only the previewed division, not the whole book", async () => {
    const { html } = await renderHtml({
      sourcePath: sectionPath,
      fragment: true,
      contextSourcePath: mainPath,
    });
    expect(html).toContain("Uses");
    // Chapter 1's prose is skeleton, so it must not appear in the page body.
    // (The lunr search index is a separate JSON blob and is not checked here.)
    const body = html.slice(html.indexOf('id="ptx-content"'));
    expect(body).not.toContain("Distinctive far prose.");
  });

  it("keeps the document's macros available to the fragment", async () => {
    const { html } = await renderHtml({
      sourcePath: sectionPath,
      fragment: true,
      contextSourcePath: mainPath,
    });
    expect(html).toContain("\\Zed");
  });

  it("renders unsaved fragment text, not the copy on disk", async () => {
    const { html } = await renderHtml({
      sourcePath: sectionPath,
      sourceContent: SECTION.replace(
        "Previewed Section",
        "Edited In The Buffer",
      ),
      fragment: true,
      contextSourcePath: mainPath,
    });
    expect(html).toContain("Edited In The Buffer");
    expect(html).not.toContain("Previewed Section");
    // Still numbered from its place in the document.
    expect(html).toContain("2.1.1");
  });

  it("makes a link to a target outside the fragment inert, and says why", async () => {
    const { html } = await renderHtml({
      sourcePath: sectionPath,
      fragment: true,
      contextSourcePath: mainPath,
      offPageMessage: "Only one section is being previewed.",
    });
    expect(html).toContain("Only one section is being previewed.");
    expect(html).toContain('aria-disabled="true"');
    // No link anywhere still points at a page that was never written.
    expect(html).not.toMatch(/href="[^"#]*\.html/);
  });

  it("keeps a reference inside the fragment clickable", async () => {
    const { html } = await renderHtml({
      sourcePath: sectionPath,
      fragment: true,
      contextSourcePath: mainPath,
    });
    // ctx-near is on this page, so its link survives as a same-page anchor.
    expect(html).toContain('href="#ctx-near"');
  });

  it("falls back to the standalone wrapper when the id is not in the document", async () => {
    const orphan = path.join(dir, "orphan.ptx");
    fs.writeFileSync(
      orphan,
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<section xml:id="not-in-the-book"><title>Orphan</title>` +
        `<p>Standalone.</p></section>\n`,
    );
    const { html } = await renderHtml({
      sourcePath: orphan,
      fragment: true,
      contextSourcePath: mainPath,
    });
    expect(html).toContain("Orphan");
    expect(html).toContain("</html>");
  });

  it("falls back when the document cannot be read", async () => {
    const { html } = await renderHtml({
      sourcePath: sectionPath,
      fragment: true,
      contextSourcePath: path.join(dir, "no-such-main.ptx"),
    });
    expect(html).toContain("Previewed Section");
  });
});
