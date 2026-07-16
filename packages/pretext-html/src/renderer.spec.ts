// These tests run the real PreTeXt stylesheets in WASM, so the suite must be
// launched with JSPI enabled: `npm run test -w @pretextbook/pretext-html`
// (which runs vitest under `node --experimental-wasm-jspi`).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isJspiAvailable, renderHtml, xpathStringLiteral } from "./renderer.js";
import { forcePortablePublication } from "./publication.js";

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

  it("resolves xi:include and respects the publication file", async () => {
    const { html } = await renderHtml({
      sourcePath: path.join(projectDir, "source", "main.ptx"),
      projectDir,
      publicationPath: path.join(projectDir, "publication.xml"),
    });
    expect(html).toContain("Content from an included file");
    // portable was forced despite the publication file saying "no"
    expect(html).toContain("cdn.jsdelivr.net");
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
