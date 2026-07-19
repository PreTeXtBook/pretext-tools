/**
 * Runtime light/dark theme control for rendered previews.
 *
 * A rendered PreTeXt page already knows how to switch between light and dark
 * — pretext-core.js exposes a global `window.setDarkMode(isDark)` — but it
 * only ever decides *which* to use from `localStorage` and the browser's
 * `prefers-color-scheme`. Neither reflects the surroundings an embedder cares
 * about: "VS Code is using a dark editor theme", "pretext.plus is in dark
 * mode". This module lets the embedding app drive the preview's theme instead.
 *
 * It is entirely opt-in, controlled by `RenderOptions.theme`. When set, the
 * renderer injects the small script produced by {@link themeBridgeScript},
 * which:
 *
 *   1. applies an *initial* theme baked into the page (so an explicit dark
 *      preview does not flash light first), and
 *   2. listens for a `postMessage` from the embedder and re-applies the theme
 *      live — no re-render needed.
 *
 * The embedder posts {@link previewThemeMessage}`(theme)` to the preview's
 * window (a VS Code webview, an `<iframe>`'s `contentWindow`, or the page's
 * own `window` for an inline render). This module has no runtime dependencies,
 * so an embedder can import just the protocol (`@pretextbook/pretext-html/theme`)
 * without pulling in the WASM renderer.
 *
 * Timing note: `window.setDarkMode` is defined by pretext-core.js only inside
 * its `DOMContentLoaded` handler, so the injected script cannot assume it
 * exists yet — it retries on `DOMContentLoaded`/`load` and remembers the last
 * requested theme on `window` so it survives the extension's in-place
 * `document.write` rebuilds.
 */

export type PreviewTheme = "dark" | "light" | "system";

/**
 * The `type` field of the message an embedder posts to drive the preview's
 * theme. Namespaced so it does not collide with an embedder's own messages.
 */
export const PREVIEW_THEME_MESSAGE = "pretext-html:set-theme";

export interface PreviewThemeMessage {
  type: typeof PREVIEW_THEME_MESSAGE;
  theme: PreviewTheme;
}

/** True when `value` is one of the three {@link PreviewTheme} strings. */
export function isPreviewTheme(value: unknown): value is PreviewTheme {
  return value === "dark" || value === "light" || value === "system";
}

/**
 * Build the message an embedder posts to a rendered preview to set its theme.
 * Send it with `webview.postMessage(...)` (VS Code), `iframe.contentWindow
 * .postMessage(..., "*")` (embedded), or `window.postMessage(...)` (inline).
 */
export function previewThemeMessage(theme: PreviewTheme): PreviewThemeMessage {
  return { type: PREVIEW_THEME_MESSAGE, theme };
}

/**
 * The inline `<script>` (as a string) that wires a rendered page to the
 * embedder's theme. Injected into the page `<head>` by the renderer when
 * `RenderOptions.theme` is set; `initial` is baked in as the starting theme.
 *
 * Written in ES5-ish, self-contained JS because it is embedded verbatim in the
 * output page (no bundler runs over it) and re-executes on every in-place
 * `document.write` rebuild. It is idempotent: handlers are keyed on `window`
 * and removed before being re-added, and the last requested theme persists on
 * `window` so a rebuilt document re-applies it rather than snapping back to
 * `initial`.
 */
export function themeBridgeScript(initial: PreviewTheme): string {
  // Baked-in config, JSON-encoded so it is safe inside the script literal.
  const cfg = JSON.stringify({ msg: PREVIEW_THEME_MESSAGE, initial });
  return [
    "<script>",
    "(function () {",
    "  var CFG = " + cfg + ";",
    // Where the last requested theme is remembered so it survives an in-place
    // document rewrite (same Window) and outranks the baked initial value.
    "  var KEY = '__ptxPreviewTheme';",
    "  var MEDIA = '(prefers-color-scheme: dark)';",
    "  function isTheme(v) {",
    "    return v === 'dark' || v === 'light' || v === 'system';",
    "  }",
    "  function prefersDark() {",
    "    return !!(window.matchMedia && window.matchMedia(MEDIA).matches);",
    "  }",
    "  function resolveDark(theme) {",
    "    if (theme === 'dark') return true;",
    "    if (theme === 'light') return false;",
    "    return prefersDark();", // "system"
    "  }",
    "  function current() {",
    "    return isTheme(window[KEY]) ? window[KEY] : CFG.initial;",
    "  }",
    // A theme with no dark variant marks the root data-darkmode="disabled";
    // never force dark mode on in that case (mirrors setDarkMode's own guard).
    "  function darkModeDisabled() {",
    "    var el = document.documentElement;",
    "    return !!(el && el.dataset && el.dataset.darkmode === 'disabled');",
    "  }",
    "  function apply(theme) {",
    "    window[KEY] = theme;",
    "    if (darkModeDisabled()) return;",
    "    var dark = resolveDark(theme);",
    // Toggle the class setDarkMode would set, right now, so an explicit theme
    // does not flash before pretext-core.js defines setDarkMode. setDarkMode
    // (once available) then does the complete job, including iframes.
    "    var el = document.documentElement;",
    "    if (el && el.classList) { el.classList.toggle('dark-mode', dark); }",
    "    if (typeof window.setDarkMode === 'function') { window.setDarkMode(dark); }",
    "  }",
    "  function reapply() { apply(current()); }",
    // Immediately (no-op until setDarkMode exists), then again once the page's
    // own script has defined it.
    "  reapply();",
    "  document.addEventListener('DOMContentLoaded', reapply);",
    "  window.addEventListener('load', reapply);",
    // Embedder -> preview live updates.
    "  if (window.__ptxThemeMsgHandler) {",
    "    window.removeEventListener('message', window.__ptxThemeMsgHandler);",
    "  }",
    "  window.__ptxThemeMsgHandler = function (event) {",
    "    var data = event && event.data;",
    "    if (data && data.type === CFG.msg && isTheme(data.theme)) {",
    "      apply(data.theme);",
    "    }",
    "  };",
    "  window.addEventListener('message', window.__ptxThemeMsgHandler);",
    // Track OS changes while following the system theme.
    "  if (window.matchMedia) {",
    "    var mq = window.matchMedia(MEDIA);",
    "    if (window.__ptxThemeMediaHandler) {",
    "      try { mq.removeEventListener('change', window.__ptxThemeMediaHandler); } catch (e) {}",
    "    }",
    "    window.__ptxThemeMediaHandler = function () {",
    "      if (current() === 'system') { reapply(); }",
    "    };",
    "    try { mq.addEventListener('change', window.__ptxThemeMediaHandler); } catch (e) {}",
    "  }",
    "})();",
    "</script>",
  ].join("\n");
}

/**
 * Inject the theme bridge script into a rendered HTML page's `<head>` (as
 * early as possible, to minimise any flash). Returns the page unchanged when
 * it has no recognisable `<head>`.
 */
export function injectThemeBridge(html: string, theme: PreviewTheme): string {
  const script = themeBridgeScript(theme);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${script}`);
  }
  return html;
}
