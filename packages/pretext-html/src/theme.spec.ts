// Pure-JS tests for the theme protocol and the injected browser bridge. The
// bridge script is executed in jsdom (no WASM / no JSPI needed); its contract
// with the real page is that it drives PreTeXt's global window.setDarkMode.

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_THEME_MESSAGE,
  injectThemeBridge,
  isPreviewTheme,
  previewThemeMessage,
  themeBridgeScript,
  type PreviewTheme,
} from "./theme.js";

describe("theme protocol helpers", () => {
  it("builds a namespaced set-theme message", () => {
    expect(previewThemeMessage("dark")).toEqual({
      type: PREVIEW_THEME_MESSAGE,
      theme: "dark",
    });
    expect(PREVIEW_THEME_MESSAGE).toBe("pretext-html:set-theme");
  });

  it("recognises valid theme strings", () => {
    for (const t of ["dark", "light", "system"]) {
      expect(isPreviewTheme(t)).toBe(true);
    }
    for (const t of ["Dark", "", null, undefined, 1, "auto"]) {
      expect(isPreviewTheme(t)).toBe(false);
    }
  });
});

describe("injectThemeBridge", () => {
  it("inserts the bridge script inside <head>", () => {
    const out = injectThemeBridge(
      "<html><head><title>x</title></head><body></body></html>",
      "dark",
    );
    expect(out).toContain("<script>");
    expect(out.indexOf("<script>")).toBeGreaterThan(out.indexOf("<head"));
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("<title>"));
    expect(out).toContain(PREVIEW_THEME_MESSAGE);
  });

  it("passes the page through unchanged when there is no <head>", () => {
    const page = "<html><body>no head here</body></html>";
    expect(injectThemeBridge(page, "light")).toBe(page);
  });
});

/**
 * Run the bridge script in a fresh jsdom document with a mock setDarkMode,
 * fire DOMContentLoaded, and return the DOM plus the recorded calls. `body`
 * class / documentElement dataset can be seeded via the html string.
 */
async function runBridge(
  initial: PreviewTheme,
  opts: { html?: string; provideSetDarkMode?: boolean } = {},
) {
  const dom = new JSDOM(
    opts.html ?? "<!doctype html><html><head></head><body></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true },
  );
  const { window } = dom;
  const calls: boolean[] = [];
  if (opts.provideSetDarkMode !== false) {
    (window as unknown as { setDarkMode: (v: boolean) => void }).setDarkMode = (
      v: boolean,
    ) => calls.push(v);
  }
  const body = themeBridgeScript(initial)
    .replace(/^<script>\n?/, "")
    .replace(/\n?<\/script>$/, "");
  window.eval(body);
  window.document.dispatchEvent(
    new window.Event("DOMContentLoaded", { bubbles: true }),
  );
  await new Promise((r) => setTimeout(r, 0));
  return { dom, window, calls };
}

describe("themeBridgeScript (executed)", () => {
  it("applies an explicit initial dark theme", async () => {
    const { window, calls } = await runBridge("dark");
    expect(calls.at(-1)).toBe(true);
    expect(
      window.document.documentElement.classList.contains("dark-mode"),
    ).toBe(true);
  });

  it("applies an explicit initial light theme", async () => {
    const { window, calls } = await runBridge("light");
    expect(calls.at(-1)).toBe(false);
    expect(
      window.document.documentElement.classList.contains("dark-mode"),
    ).toBe(false);
  });

  it("follows a set-theme message posted by the embedder", async () => {
    const { window, calls } = await runBridge("light");
    expect(calls.at(-1)).toBe(false);
    window.postMessage(previewThemeMessage("dark"), "*");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.at(-1)).toBe(true);
    // The last requested theme is remembered on window for document.write rebuilds.
    expect(
      (window as unknown as { __ptxPreviewTheme?: string }).__ptxPreviewTheme,
    ).toBe("dark");
  });

  it("ignores unrelated messages", async () => {
    const { window, calls } = await runBridge("light");
    const before = calls.length;
    window.postMessage({ type: "something-else", theme: "dark" }, "*");
    window.postMessage({ command: "update", html: "<p>x</p>" }, "*");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.length).toBe(before);
  });

  it("never forces dark mode when the theme disables it", async () => {
    const { window, calls } = await runBridge("dark", {
      html: '<!doctype html><html data-darkmode="disabled"><head></head><body></body></html>',
    });
    expect(calls).toEqual([]);
    expect(
      window.document.documentElement.classList.contains("dark-mode"),
    ).toBe(false);
  });

  it("does not throw when setDarkMode is not defined yet", async () => {
    await expect(
      runBridge("dark", { provideSetDarkMode: false }),
    ).resolves.toBeTruthy();
  });
});
