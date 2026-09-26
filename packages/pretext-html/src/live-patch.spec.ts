// Live patching runs in the page, so it is exercised here in jsdom. The pages
// mimic the structure of a rendered PreTeXt page; the last suite patches
// between two real renders, which needs JSPI like renderer.spec.ts.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  LIVE_PATCH_GLOBAL,
  livePatchScript,
  patchDocument,
  typesetPatch,
  type LivePatchResult,
} from "./live-patch.js";
import { renderHtml } from "./renderer.js";

function page(
  content: string,
  { title = "Alpha", head = "", bodyClass = "pretext book ignore-math" } = {},
): string {
  return `<!DOCTYPE html>
<html lang="en-US"><head><title>${title}</title>
<link href="https://cdn.example/theme.css" rel="stylesheet">${head}
</head>
<body class="${bodyClass}">
<div id="ptx-tools-bar"><span id="ptx-tools-status">sec.ptx</span></div>
<div id="latex-macros" class="hidden-content process-math">\\(\\newcommand{\\R}{\\mathbb R}\\)</div>
<div class="ptx-page">
<main class="ptx-main"><div id="ptx-content" class="ptx-content">
<section class="section" id="sec-a">
${content}
</section>
</div></main>
</div>
<script>window.bootstrapped = true;</script>
</body></html>`;
}

const HEADING =
  '<h2 class="heading"><span class="type">Section</span> ' +
  '<span class="codenumber">1.1</span> <span class="title">Alpha</span></h2>';

function para(id: string, text: string): string {
  return `<div class="para" id="${id}">${text}</div>`;
}

function theorem(id: string, number: string, text: string): string {
  return (
    `<article class="theorem theorem-like" id="${id}">` +
    '<h3 class="heading"><span class="type">Theorem</span> ' +
    `<span class="codenumber">${number}</span></h3>\n` +
    `${para(`${id}-1`, text)}\n</article>`
  );
}

function section(...blocks: string[]): string {
  return [HEADING, ...blocks].join("\n");
}

/** A live page (scripts not run) showing `html`, plus a parser for renders. */
function open(html: string) {
  const dom = new JSDOM(html);
  const live = dom.window.document;
  const parse = (source: string) =>
    new dom.window.DOMParser().parseFromString(source, "text/html");
  return {
    dom,
    live,
    parse,
    patch: (from: string, to: string): LivePatchResult =>
      patchDocument(live, parse(from), parse(to)),
  };
}

/**
 * Markup with whitespace-only text dropped (a patch does not copy it), and
 * without the search index, which a patch deliberately leaves stale.
 */
function normalized(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  for (const script of Array.from(clone.querySelectorAll("script"))) {
    if (script.textContent?.includes("ptx_lunr_docs")) {
      script.remove();
    }
  }
  const doc = clone.ownerDocument;
  const walker = doc.createTreeWalker(clone, 4 /* NodeFilter.SHOW_TEXT */);
  const blank: Node[] = [];
  while (walker.nextNode()) {
    if (!/\S/.test(walker.currentNode.nodeValue ?? "")) {
      blank.push(walker.currentNode);
    }
  }
  blank.forEach((node) => node.parentNode?.removeChild(node));
  return clone.outerHTML;
}

/** The live body now shows exactly what `html` renders. */
function expectShows(
  live: Document,
  parse: (s: string) => Document,
  html: string,
) {
  expect(normalized(live.body)).toBe(normalized(parse(html).body));
}

describe("patchDocument", () => {
  it("does nothing when the render is unchanged", () => {
    const html = page(section(para("sec-a-2", "One.")));
    const { patch } = open(html);
    const result = patch(html, html);
    expect(result).toMatchObject({ ok: true, attributeUpdates: 0 });
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("replaces only the edited block", () => {
    const before = page(
      section(
        para("sec-a-2", "One."),
        para("sec-a-3", "Two."),
        para("sec-a-4", "Three."),
      ),
    );
    const after = before.replace("Two.", "Two, edited.");
    const { live, parse, patch } = open(before);
    const first = live.getElementById("sec-a-2");
    const edited = live.getElementById("sec-a-3");
    const last = live.getElementById("sec-a-4");

    const result = patch(before, after);

    expect(result.ok).toBe(true);
    expect(result.removed).toEqual([edited]);
    expect(result.added.map((el) => el.textContent)).toEqual(["Two, edited."]);
    expect(live.getElementById("sec-a-2")).toBe(first);
    expect(live.getElementById("sec-a-4")).toBe(last);
    expectShows(live, parse, after);
  });

  it("moves auto-generated ids in place when a block is inserted before them", () => {
    const before = page(
      section(
        para("sec-a-2", "One."),
        para("sec-a-3", "Two."),
        para("sec-a-4", "Three."),
      ),
    );
    const after = page(
      section(
        para("sec-a-2", "One."),
        para("sec-a-3", "Brand new."),
        para("sec-a-4", "Two."),
        para("sec-a-5", "Three."),
      ),
    );
    const { live, parse, patch } = open(before);
    const two = live.getElementById("sec-a-3");
    const three = live.getElementById("sec-a-4");

    const result = patch(before, after);

    expect(result.ok).toBe(true);
    expect(result.added.map((el) => el.textContent)).toEqual(["Brand new."]);
    expect(result.removed).toEqual([]);
    expect(result.attributeUpdates).toBe(2);
    // The same elements, renumbered: not replaced, so nothing to re-typeset.
    expect(two?.id).toBe("sec-a-4");
    expect(three?.id).toBe("sec-a-5");
    expectShows(live, parse, after);
  });

  it("removes a deleted block and renumbers what follows", () => {
    const before = page(
      section(
        para("sec-a-2", "One."),
        para("sec-a-3", "Two."),
        para("sec-a-4", "Three."),
      ),
    );
    const after = page(
      section(para("sec-a-2", "One."), para("sec-a-3", "Three.")),
    );
    const { live, parse, patch } = open(before);
    const two = live.getElementById("sec-a-3");
    const three = live.getElementById("sec-a-4");

    const result = patch(before, after);

    expect(result.ok).toBe(true);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([two]);
    expect(three?.id).toBe("sec-a-3");
    expectShows(live, parse, after);
  });

  it("replaces just the heading of a block whose number changed", () => {
    const before = page(
      section(
        theorem("thm-a", "1.1.1", "Alpha holds."),
        theorem("sec-a-3", "1.1.2", "Beta holds."),
      ),
    );
    const after = page(
      section(
        theorem("thm-a", "1.1.1", "Alpha holds."),
        theorem("thm-new", "1.1.2", "Newly inserted."),
        theorem("sec-a-4", "1.1.3", "Beta holds."),
      ),
    );
    const { live, parse, patch } = open(before);
    const beta = live.getElementById("sec-a-3-1");

    const result = patch(before, after);

    expect(result.ok).toBe(true);
    expect(result.added.map((el) => el.tagName)).toEqual(["ARTICLE", "H3"]);
    expect(result.removed.map((el) => el.tagName)).toEqual(["H3"]);
    // The statement survives with its (auto-generated) id moved along.
    expect(beta?.isConnected).toBe(true);
    expect(beta?.id).toBe("sec-a-4-1");
    expectShows(live, parse, after);
  });

  it("patches several separate edits in one pass", () => {
    const blocks = ["One.", "Two.", "Three.", "Four.", "Five."];
    const before = page(
      section(...blocks.map((text, i) => para(`sec-a-${i + 2}`, text))),
    );
    const after = before.replace("One.", "One!").replace("Four.", "Four!");
    const { live, parse, patch } = open(before);
    const kept = ["sec-a-3", "sec-a-4", "sec-a-6"].map((id) =>
      live.getElementById(id),
    );

    const result = patch(before, after);

    expect(result.ok).toBe(true);
    expect(result.added.map((el) => el.textContent)).toEqual(["One!", "Four!"]);
    for (const el of kept) {
      expect(el?.isConnected).toBe(true);
    }
    expectShows(live, parse, after);
  });

  it("inserts ahead of the first child and into an empty container", () => {
    const empty = page("");
    const one = page(para("sec-a-1", "Only."));
    const two = page(
      [para("sec-a-1", "First."), para("sec-a-2", "Only.")].join("\n"),
    );
    const { live, parse, patch } = open(empty);

    expect(patch(empty, one).ok).toBe(true);
    expectShows(live, parse, one);
    expect(patch(one, two).ok).toBe(true);
    expectShows(live, parse, two);
  });

  it("updates the title without a full rewrite", () => {
    const before = page(section(para("sec-a-2", "One.")));
    const after = page(section(para("sec-a-2", "One.")), { title: "Beta" });
    const { live, patch } = open(before);
    expect(patch(before, after).ok).toBe(true);
    expect(live.title).toBe("Beta");
  });

  it("leaves classes added by the page's scripts in place", () => {
    const before = page(section(para("sec-a-2", "One.")));
    const after = page(section(para("sec-a-2", "One.")), {
      bodyClass: "pretext article ignore-math",
    });
    const { live, patch } = open(before);
    live.documentElement.classList.add("dark-mode");
    live.body.classList.add("vscode-dark");

    expect(patch(before, after).ok).toBe(true);

    expect(Array.from(live.body.classList).sort()).toEqual(
      ["article", "ignore-math", "pretext", "vscode-dark"].sort(),
    );
    expect(live.documentElement.classList.contains("dark-mode")).toBe(true);
  });

  it("keeps typeset math and script-inserted elements it did not change", () => {
    const before = page(
      section(
        para("sec-a-2", 'Math: <span class="process-math">\\(x^2\\)</span>.'),
        para("sec-a-3", "Two."),
      ),
    );
    const after = before.replace("Two.", "Two, edited.");
    const { live, patch } = open(before);
    // What MathJax and a script would have done to the page since it loaded.
    const math = live.querySelector("#sec-a-2 .process-math");
    const typeset = live.createElement("mjx-container");
    math?.replaceChildren(typeset);
    const injected = live.createElement("div");
    injected.className = "injected-by-a-script";
    live.getElementById("sec-a-2")?.after(injected);

    const result = patch(before, after);

    expect(result.ok).toBe(true);
    expect(typeset.isConnected).toBe(true);
    expect(injected.isConnected).toBe(true);
    expect(live.getElementById("sec-a-3")?.textContent).toBe("Two, edited.");
  });

  describe("pretext-core.js's copy-button wrapper around code", () => {
    const code = (text: string) =>
      `<pre class="program clipboardable" id="sec-a-3"><code>${text}</code></pre>`;
    const before = page(
      section(para("sec-a-2", "One."), code("x = 1"), para("sec-a-4", "Four.")),
    );

    /** Wrap the code block the way pretext-core.js does on load. */
    function wrapCode(live: Document): Element {
      const pre = live.getElementById("sec-a-3") as Element;
      const wrapper = live.createElement("div");
      wrapper.className = "clipboardable";
      pre.classList.remove("clipboardable");
      pre.replaceWith(wrapper);
      wrapper.append(pre);
      wrapper.insertAdjacentHTML(
        "beforeend",
        '<button class="code-copy"></button>',
      );
      return wrapper;
    }

    it("sees through the wrapper to patch around the block", () => {
      const after = before.replace("Four.", "Four, edited.");
      const { live, patch } = open(before);
      const wrapper = wrapCode(live);

      expect(patch(before, after).ok).toBe(true);
      expect(wrapper.isConnected).toBe(true);
      expect(live.getElementById("sec-a-4")?.textContent).toBe("Four, edited.");
    });

    it("replaces the wrapper along with an edited block", () => {
      const after = before.replace("x = 1", "x = 2");
      const { live, patch } = open(before);
      const wrapper = wrapCode(live);

      const result = patch(before, after);

      expect(result.ok).toBe(true);
      expect(result.removed).toEqual([wrapper]);
      expect(live.getElementById("sec-a-3")?.textContent).toBe("x = 2");
    });
  });

  describe("declines, leaving the page untouched,", () => {
    function expectDeclined(before: string, after: string, reason: RegExp) {
      const { live, patch } = open(before);
      const snapshot = live.documentElement.outerHTML;
      const result = patch(before, after);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(reason);
      expect(live.documentElement.outerHTML).toBe(snapshot);
    }

    it("when the head changed", () => {
      const before = page(section(para("sec-a-2", "One.")));
      const after = page(section(para("sec-a-2", "Two.")), {
        head: '<link href="https://cdn.example/other.css" rel="stylesheet">',
      });
      expectDeclined(before, after, /head/);
    });

    it("when a changed block holds a script", () => {
      const before = page(
        section(
          para("sec-a-2", "One."),
          '<div class="sage"><script>a()</script></div>',
        ),
      );
      const after = before.replace("a()", "b()");
      expectDeclined(before, after, /full page load/);
    });

    it("when a Runestone exercise changed", () => {
      const exercise = (text: string) =>
        `<div class="ptx-runestone-container"><div class="runestone">` +
        `<ul data-component="multiplechoice" id="rs-1"><li>${text}</li></ul>` +
        `</div></div>`;
      const before = page(section(para("sec-a-2", "One."), exercise("2")));
      const after = page(section(para("sec-a-2", "One."), exercise("3")));
      expectDeclined(before, after, /full page load/);
    });

    it("when the LaTeX macros changed", () => {
      const before = page(section(para("sec-a-2", "One.")));
      const after = before.replace("\\mathbb R", "\\mathbf R");
      expectDeclined(before, after, /full page load/);
    });

    it("when the live page no longer matches the previous render", () => {
      const before = page(section(para("sec-a-2", "One.")));
      const after = before.replace("One.", "Two.");
      const { live, patch } = open(before);
      live.querySelector(".ptx-page")?.remove();
      const result = patch(before, after);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/no longer matches/);
    });
  });

  it("replaces a container whole when a script restructured its children", () => {
    const before = page(
      section(para("sec-a-2", "One."), para("sec-a-3", "Two.")),
    );
    const after = before.replace("Two.", "Two, edited.");
    const { live, parse, patch } = open(before);
    live.getElementById("sec-a-2")?.remove();

    const result = patch(before, after);

    expect(result.ok).toBe(true);
    expect(result.added.map((el) => el.tagName)).toEqual(["SECTION"]);
    expectShows(live, parse, after);
  });
});

describe("livePatchScript", () => {
  it("installs a working, self-contained patcher in a bare page", () => {
    const before = page(
      section(para("sec-a-2", "One."), para("sec-a-3", "Two.")),
    );
    const after = before.replace("Two.", "Two, edited.");
    const dom = new JSDOM(before, { runScripts: "outside-only" });
    const script = livePatchScript();
    expect(script.startsWith("<script>")).toBe(true);
    const body = script.slice("<script>".length, -"</script>".length);
    // Anything else would end the inline script early.
    expect(body).not.toMatch(/<\/script/i);

    dom.window.eval(body);

    const installed = (dom.window as unknown as Record<string, unknown>)[
      LIVE_PATCH_GLOBAL
    ] as { patchDocument: typeof patchDocument };
    const parse = (source: string) =>
      new dom.window.DOMParser().parseFromString(source, "text/html");
    const result = installed.patchDocument(
      dom.window.document,
      parse(before),
      parse(after),
    );
    expect(result.ok).toBe(true);
    expect(dom.window.document.getElementById("sec-a-3")?.textContent).toBe(
      "Two, edited.",
    );
  });
});

describe("typesetPatch", () => {
  it("typesets the math in inserted blocks and clears what was removed", async () => {
    const { live } = open(page(""));
    const block = live.createElement("div");
    block.innerHTML =
      '<span class="process-math">\\(a\\)</span> and <span class="process-math">\\(b\\)</span>';
    const display = live.createElement("div");
    display.className = "displaymath process-math";
    const plain = live.createElement("div");
    const gone = live.createElement("div");
    const calls: Array<[string, Element[]]> = [];
    const startup = { promise: Promise.resolve() as Promise<unknown> };
    const win = {
      MathJax: {
        startup,
        typesetPromise: async (elements: Element[]) => {
          calls.push(["typeset", elements]);
        },
        typesetClear: (elements: Element[]) => {
          calls.push(["clear", elements]);
        },
      },
    } as unknown as Window;

    await typesetPatch(win, {
      added: [block, display, plain],
      removed: [gone],
    });

    expect(calls).toEqual([
      ["clear", [gone]],
      ["typeset", [...Array.from(block.children), display]],
    ]);
  });

  it("does nothing on a page without MathJax", async () => {
    const { live } = open(page(""));
    const win = live.defaultView as Window;
    await expect(
      typesetPatch(win, { added: [live.createElement("div")], removed: [] }),
    ).resolves.toBeUndefined();
  });
});

// Real renders, to keep the heuristics honest about what PreTeXt emits.
describe("patching between real renders", () => {
  const ARTICLE = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <docinfo><macros>\\newcommand{\\R}{\\mathbb{R}}</macros></docinfo>
  <article xml:id="live-article">
    <title>Live Article</title>
    <section xml:id="sec-live">
      <title>Live Section</title>
${body}
    </section>
  </article>
</pretext>
`;
  const BASE = `      <p>Opening paragraph with <m>x^2</m>.</p>
      <theorem xml:id="thm-live">
        <statement><p>Every <m>\\R</m> is fine.</p></statement>
        <proof><p>Clear.</p></proof>
      </theorem>
      <p>Closing paragraph.</p>
      <example><statement><p>An example.</p></statement></example>`;

  async function renderBoth(before: string, after: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-html-patch-"));
    try {
      const sourcePath = path.join(dir, "main.ptx");
      fs.writeFileSync(sourcePath, ARTICLE(before));
      const first = await renderHtml({
        sourcePath,
        sourceContent: ARTICLE(before),
      });
      const second = await renderHtml({
        sourcePath,
        sourceContent: ARTICLE(after),
      });
      return [first.html, second.html];
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const cases: Array<[string, string, number]> = [
    [
      "an edited paragraph",
      BASE.replace("Closing paragraph.", "Closing, edited."),
      1,
    ],
    [
      "an inserted paragraph",
      BASE.replace("      <theorem", "      <p>Inserted.</p>\n      <theorem"),
      1,
    ],
    [
      "an inserted theorem",
      BASE.replace(
        "      <p>Closing",
        "      <theorem><statement><p>New.</p></statement></theorem>\n      <p>Closing",
      ),
      4,
    ],
  ];

  it.each(cases)(
    "patches %s with a handful of replacements",
    async (_label, edited, maxAdded) => {
      const [before, after] = await renderBoth(BASE, edited);
      const { live, parse, patch } = open(before);
      const result = patch(before, after);
      expect(result.reason).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(result.added.length).toBeGreaterThan(0);
      expect(result.added.length).toBeLessThanOrEqual(maxAdded);
      expectShows(live, parse, after);
    },
    120000,
  );
});
