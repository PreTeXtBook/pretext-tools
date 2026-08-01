// Pure-JS tests for the preview banner and its injected browser bridge. The
// bridge script is executed in jsdom (no WASM / no JSPI needed); its contract
// with the page is dismiss/restore via localStorage, mirroring theme.spec.ts.

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_BANNER_STORAGE_KEY,
  injectPreviewBanner,
  previewBannerScript,
} from "./banner.js";

const PAGE =
  "<html><head><title>x</title></head><body><p>content</p></body></html>";

describe("injectPreviewBanner", () => {
  it("inserts the banner as the first thing inside <body>", () => {
    const out = injectPreviewBanner(PAGE, { message: "Heads up." });
    expect(out).toContain("Heads up.");
    expect(out.indexOf("ptx-preview-banner")).toBeGreaterThan(
      out.indexOf("<body"),
    );
    expect(out.indexOf("Heads up.")).toBeLessThan(out.indexOf("<p>content"));
  });

  it("HTML-escapes the message", () => {
    const out = injectPreviewBanner(PAGE, {
      message: `<script>alert(1)</script> & "quotes"`,
    });
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("&amp;");
    expect(out).toContain("&quot;quotes&quot;");
  });

  it("replaces a previous injection rather than piling up", () => {
    const once = injectPreviewBanner(PAGE, { message: "First." });
    const twice = injectPreviewBanner(once, { message: "Second." });
    expect(twice).not.toContain("First.");
    expect(twice).toContain("Second.");
    // Same occurrence count as a single injection (id/class/script/css), not
    // double it — proof the old block was removed, not appended alongside.
    const onceCount = once.match(/ptx-preview-banner-restore/g)?.length;
    expect(twice.match(/ptx-preview-banner-restore/g)?.length).toBe(onceCount);
  });

  it("passes the page through unchanged when there is no <body>", () => {
    const page = "<html><head></head></html>";
    expect(injectPreviewBanner(page, { message: "x" })).toBe(page);
  });
});

/**
 * Render an injected page in jsdom, run its bridge script, and return the
 * live document plus a helper to read/set the storage key directly (as an
 * embedder-independent oracle for what got persisted).
 */
async function runInjected(message: string) {
  const html = injectPreviewBanner(PAGE, { message });
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://example.test/",
  });
  const { window } = dom;
  const scriptBody = previewBannerScript()
    .replace(/^<script>\n?/, "")
    .replace(/\n?<\/script>$/, "");
  window.eval(scriptBody);
  return { dom, window };
}

describe("previewBannerScript (executed)", () => {
  it("shows the banner and hides the restore link by default", async () => {
    const { window } = await runInjected("Heads up.");
    const banner = window.document.getElementById("ptx-preview-banner")!;
    const restore = window.document.getElementById(
      "ptx-preview-banner-restore",
    )!;
    expect(banner.hidden).toBe(false);
    expect(restore.hidden).toBe(true);
    // Actually painted, not just the DOM property: catches the class of bug
    // where an unconditional `display` rule on .ptx-preview-banner outranks
    // the UA stylesheet's `[hidden] { display: none }` and the element never
    // visually disappears even though .hidden correctly reads true.
    expect(window.getComputedStyle(banner).display).toBe("flex");
  });

  it("dismissing hides the banner, shows the restore link, and persists it", async () => {
    const { window } = await runInjected("Heads up.");
    const banner = window.document.getElementById("ptx-preview-banner")!;
    const restore = window.document.getElementById(
      "ptx-preview-banner-restore",
    )!;
    const dismissBtn = banner.querySelector<HTMLButtonElement>(
      ".ptx-preview-banner-dismiss",
    )!;
    dismissBtn.click();
    expect(banner.hidden).toBe(true);
    expect(restore.hidden).toBe(false);
    expect(window.getComputedStyle(banner).display).toBe("none");
    expect(window.localStorage.getItem(PREVIEW_BANNER_STORAGE_KEY)).toBe("1");
  });

  it("restoring shows the banner again and clears the persisted flag", async () => {
    const { window } = await runInjected("Heads up.");
    const banner = window.document.getElementById("ptx-preview-banner")!;
    const restore = window.document.getElementById(
      "ptx-preview-banner-restore",
    )!;
    window.localStorage.setItem(PREVIEW_BANNER_STORAGE_KEY, "1");
    // Re-run the bridge to pick up the pre-set dismissal, as a fresh render would.
    const scriptBody = previewBannerScript()
      .replace(/^<script>\n?/, "")
      .replace(/\n?<\/script>$/, "");
    window.eval(scriptBody);
    expect(banner.hidden).toBe(true);

    restore.click();
    expect(banner.hidden).toBe(false);
    expect(restore.hidden).toBe(true);
    expect(window.localStorage.getItem(PREVIEW_BANNER_STORAGE_KEY)).toBe(null);
  });

  it("starts dismissed when localStorage already has the flag set", async () => {
    const html = injectPreviewBanner(PAGE, { message: "Heads up." });
    const dom = new JSDOM(html, {
      runScripts: "outside-only",
      url: "https://example.test/",
    });
    dom.window.localStorage.setItem(PREVIEW_BANNER_STORAGE_KEY, "1");
    const scriptBody = previewBannerScript()
      .replace(/^<script>\n?/, "")
      .replace(/\n?<\/script>$/, "");
    dom.window.eval(scriptBody);
    const banner = dom.window.document.getElementById("ptx-preview-banner");
    const restore = dom.window.document.getElementById(
      "ptx-preview-banner-restore",
    );
    expect(banner?.hidden).toBe(true);
    expect(restore?.hidden).toBe(false);
  });
});
