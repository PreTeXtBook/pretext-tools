/**
 * Dismissible "this is a live preview" warning banner.
 *
 * The preview forces `<html><platform portable="yes"/></html>` (see
 * {@link forcePortablePublication}) and skips the asset-generation step
 * entirely, so what an author sees while editing can genuinely differ from a
 * real build — different chunking, no locally generated images, etc. The
 * banner exists to say so, once, without nagging: it renders across the top
 * of the page, can be dismissed, and leaves an unobtrusive link behind that
 * brings it back.
 *
 * The warning text itself is entirely the caller's: the two embedders this
 * package ships for phrase the same fact differently (the VS Code extension
 * talks about "the publication file"; pretext.plus talks about "build
 * settings"), and there is no wording that fits both. See
 * {@link RenderOptions.previewBanner}.
 *
 * Dismissal is remembered in `localStorage`, not on `window` the way the
 * theme/reveal bridges remember their state. Those need to survive only an
 * in-place `document.write` rebuild (same window, new render moments later);
 * a reader dismissing this banner expects it to stay dismissed the next time
 * they open the preview too, including after the extension falls back to a
 * full `webview.html` reassignment (a new document, same as a page reload).
 */

export interface PreviewBannerOptions {
  /**
   * Warning text shown in the banner. Plain text — it is HTML-escaped before
   * being embedded, so no markup can be passed through it.
   */
  message: string;
}

/** localStorage key the injected script reads/writes to remember dismissal. */
export const PREVIEW_BANNER_STORAGE_KEY = "ptxPreviewBannerDismissed";

/** Label of the unobtrusive link left behind after the banner is dismissed. */
const RESTORE_LABEL = "About live preview";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The banner's markup: the warning bar itself, plus the restore link that
 * takes its place once dismissed. Both are always present in the page —
 * {@link previewBannerScript} toggles which is `hidden` — so there is nothing
 * for a slow script load to race.
 */
function previewBannerMarkup(message: string): string {
  return [
    '<div id="ptx-preview-banner" class="ptx-preview-banner" role="note">',
    `  <span class="ptx-preview-banner-text">${escapeHtml(message)}</span>`,
    '  <button type="button" class="ptx-preview-banner-dismiss" aria-label="Dismiss">&times;</button>',
    "</div>",
    `<button type="button" id="ptx-preview-banner-restore" class="ptx-preview-banner-restore" hidden>${escapeHtml(RESTORE_LABEL)}</button>`,
  ].join("\n");
}

/**
 * Styling for the banner and its restore link. Colours are given for both
 * light and dark mode explicitly (via `html.dark-mode`, the class
 * {@link injectThemeBridge}/pretext-core.js's own toggle both set on
 * `<html>`) rather than `prefers-color-scheme`, so the banner always matches
 * whichever mode the page itself is actually in.
 */
function previewBannerCss(): string {
  return [
    "<style>",
    ".ptx-preview-banner {",
    "  display: flex;",
    "  align-items: center;",
    "  gap: 0.75em;",
    "  padding: 0.5em 1em;",
    "  font-size: 0.9em;",
    "  background: #fff8e1;",
    "  color: #6b5300;",
    "  border-bottom: 1px solid #f0c36d;",
    "}",
    // The [hidden] content attribute only hides an element via the
    // user-agent stylesheet's `[hidden] { display: none }` rule, and a
    // normal-priority *author* rule always wins over a normal-priority UA
    // rule regardless of selector specificity — so the unconditional
    // `display: flex` above would otherwise keep the banner visible even
    // after previewBannerScript sets `banner.hidden = true`.
    ".ptx-preview-banner[hidden] {",
    "  display: none;",
    "}",
    ".ptx-preview-banner-text {",
    "  flex: 1 1 auto;",
    "}",
    ".ptx-preview-banner-dismiss {",
    "  flex: 0 0 auto;",
    "  background: transparent;",
    "  border: none;",
    "  font-size: 1.2em;",
    "  line-height: 1;",
    "  cursor: pointer;",
    "  color: inherit;",
    "  padding: 0 0.25em;",
    "}",
    "html.dark-mode .ptx-preview-banner {",
    "  background: #3a2f00;",
    "  color: #f2d27a;",
    "  border-bottom-color: #6b5300;",
    "}",
    ".ptx-preview-banner-restore {",
    "  position: fixed;",
    "  right: 0.5em;",
    "  bottom: 0.5em;",
    "  z-index: 1000;",
    "  background: transparent;",
    "  border: none;",
    "  padding: 0.15em 0.4em;",
    "  font-size: 0.75em;",
    "  color: inherit;",
    "  opacity: 0.45;",
    "  text-decoration: underline;",
    "  cursor: pointer;",
    "}",
    ".ptx-preview-banner-restore:hover {",
    "  opacity: 0.85;",
    "}",
    // Printing a preview is a real workflow — the print-preview layout exists
    // to be printed from (see printout.ts) — and a warning about the preview
    // has no business on the paper.
    "@media print {",
    "  .ptx-preview-banner, .ptx-preview-banner-restore {",
    "    display: none !important;",
    "  }",
    "}",
    "</style>",
  ].join("\n");
}

/**
 * The inline `<script>` (as a string) that wires up dismiss/restore.
 *
 * Written in ES5-ish, self-contained JS because it is embedded verbatim in
 * the output page (no bundler runs over it) and re-executes on every
 * in-place `document.write` rebuild. It is idempotent: re-reading
 * `localStorage` and re-applying the resulting visibility is harmless however
 * many times it runs.
 */
export function previewBannerScript(): string {
  const key = JSON.stringify(PREVIEW_BANNER_STORAGE_KEY);
  return [
    "<script>",
    "(function () {",
    "  var KEY = " + key + ";",
    '  var banner = document.getElementById("ptx-preview-banner");',
    '  var restore = document.getElementById("ptx-preview-banner-restore");',
    "  if (!banner || !restore) { return; }",
    // localStorage can throw (disabled cookies/storage, sandboxed iframe);
    // fall back to always showing the banner rather than crashing the page.
    "  function isDismissed() {",
    "    try { return window.localStorage.getItem(KEY) === '1'; }",
    "    catch (e) { return false; }",
    "  }",
    "  function setDismissed(value) {",
    "    try {",
    "      if (value) { window.localStorage.setItem(KEY, '1'); }",
    "      else { window.localStorage.removeItem(KEY); }",
    "    } catch (e) {}",
    "  }",
    "  function apply(dismissed) {",
    "    banner.hidden = dismissed;",
    "    restore.hidden = !dismissed;",
    "  }",
    "  apply(isDismissed());",
    '  var dismissBtn = banner.querySelector(".ptx-preview-banner-dismiss");',
    "  if (dismissBtn) {",
    "    dismissBtn.addEventListener('click', function () {",
    "      setDismissed(true);",
    "      apply(true);",
    "    });",
    "  }",
    "  restore.addEventListener('click', function () {",
    "    setDismissed(false);",
    "    apply(false);",
    "  });",
    "})();",
    "</script>",
  ].join("\n");
}

/**
 * Sentinel comments bracketing everything this module injects, so a later
 * injection can find and replace its predecessor instead of piling up beside
 * it (mirrors {@link injectRevealBridge}'s own sentinel).
 */
const INJECTED_OPEN = "<!--ptx-preview-banner-->";
const INJECTED_CLOSE = "<!--/ptx-preview-banner-->";
const INJECTED_BLOCK =
  /\n?<!--ptx-preview-banner-->[\s\S]*?<!--\/ptx-preview-banner-->/;

/**
 * Inject the warning banner into a rendered page, as the first thing inside
 * `<body>` — ahead of PreTeXt's own masthead, so it reads as a notice about
 * the page rather than part of it.
 *
 * Returns the page unchanged when no `<body>` tag is found.
 */
export function injectPreviewBanner(
  html: string,
  options: PreviewBannerOptions,
): string {
  const existing = INJECTED_BLOCK.exec(html);
  const base = existing
    ? html.slice(0, existing.index) +
      html.slice(existing.index + existing[0].length)
    : html;
  if (!/<body[^>]*>/i.test(base)) {
    return base;
  }
  const injected =
    `\n${INJECTED_OPEN}\n${previewBannerCss()}\n` +
    `${previewBannerMarkup(options.message)}\n${previewBannerScript()}\n${INJECTED_CLOSE}`;
  return base.replace(/<body([^>]*)>/i, `<body$1>${injected}`);
}
