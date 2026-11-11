// The live page's bootstrap, run in jsdom the way the webview runs it: at the
// end of a delivered page, beside the patcher, with a stand-in for
// acquireVsCodeApi. Covers how an "update" message is applied — patched into
// the page on screen, or written over it.

import { livePatchScript } from "@pretextbook/pretext-html/live-patch";
// jsdom ships no type declarations, and this package compiles without the DOM
// lib (it is extension-host code), so the few page members used here are
// typed locally below.
// @ts-expect-error -- untyped module
import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_TYPESET_STALLS,
  liveBootstrapScript,
  previewCsp,
} from "./preview-bootstrap";

interface PageElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): PageElement | null;
  click(): void;
}

interface PageDocument {
  getElementById(id: string): PageElement | null;
  open: unknown;
  write: unknown;
  close: unknown;
}

/** A delivered page, reduced to what the bootstrap cares about. */
function page(
  text: string,
  { head = "", status = "sec.ptx" }: { head?: string; status?: string } = {},
): string {
  return `<!DOCTYPE html>
<html><head><title>Preview</title>${head}</head>
<body>
<div id="ptx-tools-bar"><button type="button" data-ptx-mode="full">Full build</button>
<span id="ptx-tools-status">${status}</span></div>
<main class="ptx-main"><div id="ptx-content"><section class="section" id="sec">
<div class="para" id="p1">Unchanged.</div>
<div class="para" id="p2">${text}</div>
</section></div></main>
${livePatchScript()}
${liveBootstrapScript()}
</body></html>`;
}

interface Webview {
  window: Record<string, unknown>;
  document: PageDocument;
  /** Messages the page posted to the extension. */
  posted: unknown[];
  /** Pages written over the document (the fallback path). */
  written: string[];
  /** Deliver a message from the extension. */
  send: (message: unknown) => void;
}

function openWebview(html: string): Webview {
  const posted: unknown[] = [];
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error) => {
    // jsdom has no layout, so scrolling is a stub that complains.
    if (!/Not implemented/.test(error.message)) {
      errors.push(error.message);
    }
  });
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    virtualConsole,
    beforeParse(window: object) {
      Object.assign(window, {
        acquireVsCodeApi: () => ({
          postMessage: (message: unknown) => posted.push(message),
          getState: () => undefined,
          setState: () => undefined,
        }),
      });
    },
  });
  expect(errors).toEqual([]);
  const window = dom.window;
  const document: PageDocument = window.document;
  // jsdom cannot rewrite a loaded document in place; record it instead.
  const written: string[] = [];
  document.open = vi.fn();
  document.write = (markup: string) => {
    written.push(markup);
  };
  document.close = vi.fn();
  return {
    window,
    document,
    posted,
    written,
    send: (message) =>
      window.dispatchEvent(
        new window.MessageEvent("message", { data: message }),
      ),
  };
}

describe("the live page's update handler", () => {
  it("patches an update into the page it was rendered from", () => {
    const before = page("Before.");
    const after = page("After.");
    const webview = openWebview(before);
    const unchanged = webview.document.getElementById("p1");

    webview.send({
      command: "update",
      html: after,
      patch: true,
      previous: before,
    });

    expect(webview.written).toEqual([]);
    expect(webview.document.getElementById("p2")?.textContent).toBe("After.");
    expect(webview.document.getElementById("p1")).toBe(unchanged);
    expect(webview.posted).toContainEqual({
      command: "patchResult",
      ok: true,
      reason: undefined,
      changed: 1,
    });
  });

  it("patches later updates against the copy it kept", () => {
    const webview = openWebview(page("One."));
    webview.send({
      command: "update",
      html: page("Two."),
      patch: true,
      previous: page("One."),
    });

    webview.send({ command: "update", html: page("Three."), patch: true });

    expect(webview.written).toEqual([]);
    expect(webview.document.getElementById("p2")?.textContent).toBe("Three.");
  });

  it("rewrites the page when it has nothing to diff against", () => {
    const webview = openWebview(page("Before."));
    const after = page("After.");

    webview.send({ command: "update", html: after, patch: true });

    expect(webview.written).toEqual([after]);
    expect(webview.window.__ptxRawHtml).toBe(after);
  });

  it("rewrites the page when told not to patch", () => {
    const before = page("Before.");
    const after = page("After.");
    const webview = openWebview(before);

    webview.send({ command: "update", html: after, patch: false });

    expect(webview.written).toEqual([after]);
    expect(webview.posted).toEqual([]);
  });

  it("rewrites the page when the patch declines, and diffs against it next", () => {
    const before = page("Before.");
    const after = page("After.", {
      head: '<link rel="stylesheet" href="https://cdn.example/other.css">',
    });
    const webview = openWebview(before);

    webview.send({
      command: "update",
      html: after,
      patch: true,
      previous: before,
    });

    expect(webview.written).toEqual([after]);
    expect(webview.posted).toContainEqual(
      expect.objectContaining({
        command: "patchResult",
        ok: false,
        reason: expect.stringMatching(/head/),
      }),
    );
    expect(webview.window.__ptxRawHtml).toBe(after);
  });

  it("wires up a toolbar the patch replaced", () => {
    const before = page("Before.");
    const after = page("Before.", { status: "other.ptx" });
    const webview = openWebview(before);
    const oldBar = webview.document.getElementById("ptx-tools-bar");

    webview.send({
      command: "update",
      html: after,
      patch: true,
      previous: before,
    });

    const bar = webview.document.getElementById("ptx-tools-bar");
    expect(bar).not.toBe(oldBar);
    bar?.querySelector("button")?.click();
    expect(webview.posted).toContainEqual({ command: "setMode", mode: "full" });
  });
});

describe("when MathJax does not finish typesetting a patch", () => {
  const math = (tex: string) =>
    `<span class="process-math">\\(${tex}\\)</span>`;
  const update = (webview: ReturnType<typeof openWebview>, html: string) =>
    webview.send({ command: "update", html, patch: true });
  /** Long enough for the page's patch promise chain to run. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** A page whose MathJax answers each patch's typeset as the test says. */
  function openWithMathJax(html: string, finished: boolean) {
    const webview = openWebview(html);
    // Stands in for the patcher's typeset step, whose own waiting is covered
    // in @pretextbook/pretext-html: what matters here is what the page does
    // with the answer.
    (webview.window.__ptxLivePatch as { typeset: unknown }).typeset = () =>
      Promise.resolve(finished);
    return webview;
  }

  it("rewrites the page, so the math is typeset from scratch", async () => {
    const before = page(math("a"));
    const after = page(math("b"));
    const webview = openWithMathJax(before, false);
    update(webview, before);
    webview.written.length = 0;

    update(webview, after);
    expect(webview.written).toEqual([]); // patched
    await settle();

    expect(webview.written).toEqual([after]);
    expect(webview.posted).toContainEqual(
      expect.objectContaining({
        command: "patchResult",
        ok: false,
        reason: expect.stringContaining("MathJax did not finish"),
      }),
    );
  });

  it("stops patching once it keeps happening", async () => {
    const pages = ["a", "b", "c", "d"].map((tex) => page(math(tex)));
    const webview = openWithMathJax(pages[0], false);
    update(webview, pages[0]);
    for (let stall = 1; stall <= MAX_TYPESET_STALLS; stall++) {
      update(webview, pages[stall]);
      await settle();
    }
    webview.written.length = 0;
    webview.posted.length = 0;

    update(webview, pages[MAX_TYPESET_STALLS + 1]);

    // Written straight away, with no patch attempted first.
    expect(webview.written).toEqual([pages[MAX_TYPESET_STALLS + 1]]);
    expect(webview.posted).toEqual([]);
  });

  it("leaves a page alone whose math was typeset", async () => {
    const before = page(math("a"));
    const webview = openWithMathJax(before, true);
    update(webview, before);
    webview.written.length = 0;

    update(webview, page(math("b")));
    await settle();

    expect(webview.written).toEqual([]);
  });
});

describe("the as-you-type toggle", () => {
  const withToggle = (pressed: boolean) =>
    page("Text.").replace(
      "</div>",
      `<button type="button" id="typing" data-ptx-action="toggleTyping"` +
        ` aria-pressed="${pressed}">As you type</button></div>`,
    );

  it("flips at once and tells the extension", () => {
    const webview = openWebview(withToggle(true));
    const toggle = webview.document.getElementById("typing");
    toggle?.click();
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(webview.posted).toContainEqual({
      command: "setTyping",
      typing: false,
    });
  });

  it("follows the setting when it is changed elsewhere", () => {
    const webview = openWebview(withToggle(false));
    webview.send({ command: "typing", on: true });
    expect(
      webview.document.getElementById("typing")?.getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("previewCsp", () => {
  const directives = new Map(
    previewCsp("vscode-webview://abc")
      .split("; ")
      .map((directive) => {
        const [name, ...sources] = directive.split(" ");
        return [name, sources] as const;
      }),
  );

  it("lets MathJax start its speech worker from a blob: URL", () => {
    // Without this the worker falls back to script-src, is blocked, and
    // MathJax's startup never settles: math patched into the page stays raw.
    expect(directives.get("worker-src")).toContain("blob:");
    expect(directives.get("script-src")).not.toContain("blob:");
  });

  it("covers the webview's own resources and the CDN", () => {
    expect(directives.get("default-src")).toEqual(["'none'"]);
    expect(directives.get("img-src")).toContain("vscode-webview://abc");
    expect(directives.get("script-src")).toContain("https:");
  });
});
