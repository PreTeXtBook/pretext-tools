/**
 * Print-preview layout for the printouts on a rendered page.
 *
 * A worksheet or handout is written to be printed and handed out, and PreTeXt
 * lays one out very differently on paper than on screen: paginated to the
 * chosen paper size, headers and footers on each sheet, solutions dropped, and
 * — the part that is impossible to judge from the ordinary view — every
 * `<workspace>` grown to the height the author asked for, so the blank space a
 * student writes in is actually shown. An author editing a worksheet wants to
 * see *that*, not the web version of it.
 *
 * ## How the built page does it, and why the preview cannot
 *
 * All of it is client-side, in pretext-core.js, and the entire entry point is a
 * URL query parameter: `?printpreview=<html-id>`. On DOMContentLoaded the
 * script swaps the theme stylesheet for `print-worksheet.css`, moves the named
 * printout to be the page's only content, flattens its knowls, and paginates
 * it. Upstream's print icon on a printout heading is nothing more than a link
 * to that URL.
 *
 * A preview has no such URL. It is rendered in memory and handed to a host — a
 * VS Code webview, an iframe on pretext.plus — so there is no page to reload
 * and no query string of ours to put the parameter in; the link is disabled in
 * the preview wrapper for exactly that reason (see PRINTOUT_LINK_OVERRIDE in
 * scripts/refresh-xsl.mjs). What this module does is supply the parameter
 * without the navigation: {@link injectPrintPreview} adds a small script that
 * makes `new URLSearchParams(window.location.search)` — the one and only place
 * pretext-core.js looks — report a `printpreview` parameter that is not in the
 * URL at all.
 *
 * Rewriting the URL itself would be the obvious alternative and does not work
 * here: `history.replaceState` throws in a document whose origin cannot own a
 * new URL (a `vscode-webview://` page, an `about:blank` document written into
 * in place), and on a host like pretext.plus it would corrupt the app's own
 * address. Patching the reader is inert by comparison — it adds a parameter to
 * one particular string and touches nothing else.
 *
 * ## Switching in and out
 *
 * By re-delivering the page, not by talking to a live one, exactly as the
 * slideshow view toggle does (see reveal.ts). pretext-core.js runs the whole
 * transformation once, from a DOMContentLoaded handler, and it is thoroughly
 * destructive — sections are removed from the DOM, knowls are flattened,
 * `<details>` become `<div>`s. There is no undo. Since the embedder already
 * holds the rendered HTML, leaving print preview means re-injecting the *off*
 * state into that pristine HTML and delivering it again; a fresh document
 * (whether from a reload or an in-place `document.write`) fires
 * DOMContentLoaded again and the page comes up in the other mode. No re-render.
 *
 * Injecting the off state matters as much as injecting the on state: a
 * `document.write` rebuild reuses the same `Window`, so a patch installed by an
 * earlier delivery is still in place. The script therefore keeps the wanted id
 * in a window property it re-reads on every call, and the off state clears it.
 *
 * ## Paper at true size, whatever the panel
 *
 * Upstream plans page breaks and workspace against a fixed sheet (794px wide
 * while measuring, then 816 or 794 for Letter or A4), but its screen styles
 * let the pages shrink with the viewport. In a narrow editor panel the text
 * then wraps tighter than the plan assumed and pages overflow. The print
 * layout here always lays the sheet out at full width and scales it to the
 * panel with a CSS transform, with a small correction that keeps upstream's
 * measurements exact under that scale — see {@link installPrintFit}.
 *
 * ### Temporary: remove when PreTeXt does this itself
 *
 * This scaling is a stopgap for a fix that belongs in pretext-core.js and
 * print-worksheet.css, proposed as PreTeXtBook/pretext#3326. Once
 * HTML_STATIC_VERSION (html-static.ts) is a release that includes it — its
 * print-worksheet.css mentions `--ptx-printout-scale` — delete, in the same
 * change as the version bump:
 *
 * - {@link installPrintFit}, {@link unzoomRect}, {@link printFitZoom},
 *   `RectBox`, {@link PRINT_FIT_PROPERTY} and
 *   {@link PRINT_FIT_SHRINK_PROPERTY}, and their specs;
 * - the `installPrintFit` line in {@link printPreviewBridgeScript};
 * - the `@media screen` block in `printPreviewCss`.
 *
 * Until then the two coexist: these rules outrank upstream's (`:root`), so
 * the sheet is scaled once, and upstream reads its scale off a rectangle
 * that the patch here has already corrected, so it corrects nothing twice.
 *
 * What stays, here and in the VS Code extension, because it is about the
 * host and not the layout: the `URLSearchParams` bridge, light mode and the
 * paper background, the webview's `worker-src blob:` policy, delivering print
 * preview into a fresh Window, and the forward-sync scroll in
 * preview-bootstrap.ts (which may go back to `rect.top` arithmetic, but need
 * not).
 */

/** A printout on a rendered page: a division the reader can lay out for print. */
export interface PrintoutInfo {
  /**
   * The printout element's HTML id — what `?printpreview=` names, and what
   * {@link injectPrintPreview} takes.
   */
  id: string;
  /** Localized division type: "Worksheet", "Handout", "Project", … */
  type: string;
  /** The printout's number as printed ("2.3"), or "" when it has none. */
  number: string;
  /** The printout's title as plain text, or "" when it is untitled. */
  title: string;
  /**
   * The three above composed into one line — "Worksheet 2.3: Counting" — for
   * an embedder that just wants to put the page's printouts in a menu.
   */
  label: string;
}

/**
 * The print-preview buttons the preview wrapper draws on printout headings,
 * which carry the `data-printout*` attributes this module reads. Both the
 * attributes and the markup around them are generated by this package (see
 * PRINTOUT_LINK_OVERRIDE in scripts/refresh-xsl.mjs), so matching them
 * textually is matching our own output, not parsing arbitrary HTML.
 */
const PRINT_LINK = /<a\b[^>]*\bdata-printout="[^"]*"[^>]*>/gi;

/** Read one attribute out of a start tag, undefined when it is absent. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
  return match ? decodeAttribute(match[1]) : undefined;
}

/**
 * Undo the escaping the serializer applied to an attribute value. Titles are
 * ordinary prose and routinely contain `&` — a page about "Rings & Fields"
 * must not offer a menu entry reading "Rings &amp; Fields".
 */
function decodeAttribute(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, "&");
}

/** "Worksheet 2.3: Counting", dropping whichever parts the printout lacks. */
function printoutLabel(type: string, number: string, title: string): string {
  const heading = [type, number].filter(Boolean).join(" ");
  if (heading && title) {
    return `${heading}: ${title}`;
  }
  return heading || title;
}

/**
 * The printouts on a rendered page, in document order.
 *
 * Empty for a page with none, which is the signal an embedder wants: with no
 * printouts there is nothing to offer, and — because PreTeXt only emits the
 * paper-size and print-options controls on a page that has one — no print
 * preview to be had either.
 */
export function listPrintouts(html: string): PrintoutInfo[] {
  const printouts: PrintoutInfo[] = [];
  const seen = new Set<string>();
  for (const [tag] of html.matchAll(PRINT_LINK)) {
    const id = attribute(tag, "data-printout");
    // A printout that somehow reached the page without an id cannot be asked
    // for by `?printpreview=`, so it is not something to offer.
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const type = attribute(tag, "data-printout-type") ?? "";
    const number = attribute(tag, "data-printout-number") ?? "";
    const title = attribute(tag, "data-printout-title") ?? "";
    printouts.push({
      id,
      type,
      number,
      title,
      label: printoutLabel(type, number, title),
    });
  }
  return printouts;
}

/**
 * Element names whose fragments are a printout in their own right: upstream's
 * &PRINTOUT; entity (worksheet, handout) plus the project-likes, which earn a
 * print button when they carry a `@workspace`. Listing a project-like that has
 * none costs nothing — a page that draws no print button for it reports no
 * printouts, and there is then nothing for {@link rootPrintoutId} to return.
 */
const PRINTOUT_ELEMENTS = new Set([
  "worksheet",
  "handout",
  "project",
  "activity",
  "exploration",
  "investigation",
]);

/**
 * The printout to open in print preview when a document is *itself* a printout
 * — the case of previewing `worksheet-3.ptx`, whose root element is the
 * `<worksheet>`. Nothing else in the file competes for the reader's attention,
 * so the paper layout is what they came to see.
 *
 * `rootElement` is the document's root element name **before** any fragment
 * wrapping: a lone worksheet is rendered inside a synthesized `<article>`, and
 * by the time the page exists that is all the HTML can say. The printout is the
 * page's first, since the wrapper holds nothing else.
 *
 * Undefined for a document that merely contains printouts — a chapter with
 * three worksheets in it should open as the chapter.
 */
export function rootPrintoutId(
  printouts: PrintoutInfo[],
  rootElement: string | undefined,
): string | undefined {
  if (!rootElement || !PRINTOUT_ELEMENTS.has(rootElement)) {
    return undefined;
  }
  return printouts[0]?.id;
}

/**
 * Window property holding the id the patched reader should report. Read on
 * every call rather than captured, so re-injecting into a document that shares
 * a `Window` with an earlier one (an in-place `document.write` rebuild) changes
 * the answer instead of piling a second patch on the first.
 */
export const PRINT_PREVIEW_GLOBAL = "__ptxPrintPreview";

/**
 * The inline `<script>` (as a string) that makes pretext-core.js see a
 * `printpreview` query parameter, or — with no id — stop seeing one.
 *
 * Written in ES5-ish, self-contained JS because it is embedded verbatim in the
 * output page (no bundler runs over it) and re-executes on every in-place
 * `document.write` rebuild.
 *
 * The wrapper is deliberately narrow: it adds the parameter only when the
 * caller passed the location's own search string, which is what pretext-core.js
 * does and what nothing else has reason to do. Everything else — a
 * `URLSearchParams` built from a form, from another URL, from an object — is
 * constructed and returned untouched. Returning a real `URLSearchParams` from
 * the constructor (rather than subclassing) keeps `instanceof` honest and works
 * whether or not the caller says `new`.
 */
export function printPreviewBridgeScript(printoutId?: string): string {
  const wanted = JSON.stringify(printoutId ?? null);
  const global = JSON.stringify(PRINT_PREVIEW_GLOBAL);
  return [
    "<script>",
    "(function () {",
    "  var KEY = " + global + ";",
    "  window[KEY] = " + wanted + ";",
    // Pin the page to light mode for the print layout; see printPreviewCss.
    // `data-darkmode="disabled"` is upstream's own switch — pretext-core.js
    // checks it in both isDarkMode and setDarkMode, the only two places that
    // touch the class — and the theme bridge honours it too (theme.ts), so a
    // later theme message from the embedder cannot undo this. Nothing removes
    // the attribute again: leaving print preview delivers a new document,
    // whose <html> carries whatever the render authored.
    "  if (window[KEY] && window.document.documentElement) {",
    "    var root = window.document.documentElement;",
    "    if (root.classList) { root.classList.remove('dark-mode'); }",
    "    root.setAttribute('data-darkmode', 'disabled');",
    // Fit the paper to the panel (installPrintFit). Before the early return
    // below: each delivered document needs its own observer.
    `    (${installPrintFit.toString()})(window, ${printFitZoom.toString()}, ` +
      `${unzoomRect.toString()}, ${JSON.stringify(PRINT_FIT_PROPERTY)}, ` +
      `${JSON.stringify(PRINT_FIT_SHRINK_PROPERTY)});`,
    "  }",
    // The patch survives a document.write rebuild along with the Window, so
    // installing it twice would stack wrappers; the id above is what changes.
    "  if (window.__ptxPrintPreviewPatched) { return; }",
    "  var Base = window.URLSearchParams;",
    "  if (!Base) { return; }",
    "  window.__ptxPrintPreviewPatched = true;",
    "  function Patched(init) {",
    "    var params = new Base(init === undefined || init === null ? '' : init);",
    "    var id = window[KEY];",
    "    if (id && typeof init === 'string' && init === window.location.search) {",
    "      params.set('printpreview', id);",
    "    }",
    "    return params;",
    "  }",
    "  Patched.prototype = Base.prototype;",
    "  window.URLSearchParams = Patched;",
    "})();",
    "</script>",
  ].join("\n");
}

/**
 * Styling the print-preview layout needs from its host, and gets from nobody
 * else: a page that looks like paper.
 *
 * Entering print preview *replaces* the theme stylesheet with
 * `print-worksheet.css`, and that stylesheet deliberately paints no background
 * on `<body>` — in a real build the theme underneath it does. Swapped in over an
 * embedded preview there is nothing underneath, so the page shows whatever its
 * host put behind it. In a VS Code webview under a dark editor theme that is a
 * dark backdrop, with the print stylesheet's black text on top of it: unreadable,
 * and the exact symptom this exists to prevent. So state the paper explicitly,
 * deferring to the print stylesheet's own variables where it has them.
 *
 * `color-scheme: light` covers what CSS alone cannot: scrollbars, and the form
 * controls in PreTeXt's own print options (the paper-size radios, the
 * hide-solutions checkboxes), which the user agent would otherwise draw dark.
 *
 * Only ever emitted for the print-preview state. The ordinary page keeps its
 * theme, dark mode included.
 */
function printPreviewCss(): string {
  return [
    "<style>",
    ":root {",
    "  color-scheme: light;",
    "}",
    // !important because the rule this has to beat is the *host's*, not the
    // page's: VS Code injects a `body { background-color:
    // var(--vscode-editor-background) }` of its own into every webview
    // document, and where it injects it is not ours to rely on. The values
    // still come from the print stylesheet's variables, so it stays in charge
    // of what "paper" looks like.
    "html, body {",
    "  background: var(--page-color, #fff) !important;",
    "  color: var(--body-text-color, #000) !important;",
    "}",
    // Paper at its true width, scaled to fit the panel: see installPrintFit.
    // The printout keeps the full sheet width whatever the viewport, so text
    // wraps where it will on paper. Upstream's screen rules size it the other
    // way around — `max-width` of the sheet and `.onepage { width: 100% }` —
    // which is what let a narrow panel lay the pages out narrower than the
    // sheet their breaks were planned for.
    //
    // Scaled with `transform`, not `zoom`: a transform only changes how the
    // laid-out sheet is painted, so the layout upstream measures is exactly
    // the full-size one. `zoom` re-lays the text out at the smaller size, where
    // font metrics round differently — measured, that moved workspaces by up
    // to 28px on a worksheet with figures and display math. A transform does
    // not give back the room the sheet no longer needs, so negative margins
    // do: the width's from the fit, the height's from installPrintFit, which
    // tracks the printout's height.
    //
    // `.ptx-main` holds the print controls as well as the printout; capping
    // it at the *scaled* sheet width keeps the controls lined up with the
    // paper below them. Screen only: printing lays the sheet out unscaled.
    //
    // `:root` for specificity: pretext-core.js swaps print-worksheet.css in
    // where the theme's <link> was, *after* this block, so its own
    // `.ptx-main { max-width }` and `.printout { margin: 0 auto }` would win
    // a tie.
    "@media screen {",
    `  :root .ptx-main { max-width: calc(var(--ws-width) * var(${PRINT_FIT_PROPERTY}, 1)); }`,
    // `flow-root` on the printout's own parent (`.ptx-content`, as upstream
    // moves it) so the negative bottom margin shortens that parent, rather
    // than collapsing through it and leaving its full unscaled height to
    // overflow into the page's scroll area.
    "  :root :has(> .printout) { display: flow-root; }",
    // In a narrow panel the scaled sheet is narrower than upstream's
    // "Printing options" and "Print" buttons side by side, which would then
    // stick out past it and scroll the page sideways; let them wrap instead.
    "  :root .print-controls { flex-wrap: wrap; justify-content: flex-end; }",
    "  :root .printout {",
    "    min-width: var(--ws-width);",
    `    transform: scale(var(${PRINT_FIT_PROPERTY}, 1));`,
    "    transform-origin: 0 0;",
    "    margin-left: 0;",
    `    margin-right: calc(var(--ws-width) * (var(${PRINT_FIT_PROPERTY}, 1) - 1));`,
    `    margin-bottom: var(${PRINT_FIT_SHRINK_PROPERTY}, 0px);`,
    "  }",
    "}",
    "</style>",
  ].join("\n");
}

/**
 * Custom property on `<html>` holding the scale that fits the paper to the
 * panel; set by {@link installPrintFit}, read by {@link printPreviewCss}.
 */
export const PRINT_FIT_PROPERTY = "--ptx-print-fit";

/**
 * Custom property on `<html>` holding the (negative) bottom margin that takes
 * back the height the scaled printout no longer occupies.
 */
export const PRINT_FIT_SHRINK_PROPERTY = "--ptx-print-fit-shrink";

/** The parts of a `DOMRect` the rect correction reads and builds. */
export interface RectBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Map a rect read off a scaled element back into unscaled layout space, given
 * the rect of the scaled ancestor (`host`, scaled about its top-left) and its
 * scale.
 *
 * A transform scales `getBoundingClientRect()` but not `offsetHeight`,
 * `clientWidth` or computed styles. pretext-core.js plans pages almost
 * entirely in offset heights, but mixes in a few rects — `getPageContentBottom`
 * subtracts a computed padding from a rect's bottom, iframe placeholders are
 * sized from rects, the footnote gap is written back as a margin — and under a
 * scale each of those is quietly wrong. Measured: switching paper size in a
 * page scaled to 0.5 put workspaces 4px off the unscaled plan. Unscaled about
 * the host's top-left, every rect inside it agrees with the offsets again.
 *
 * The host's own position is left as is — the transform origin does not move
 * — and only its size is unscaled, which the formula gives when `rect` is
 * `host`.
 */
export function unzoomRect(
  rect: RectBox,
  host: RectBox,
  scale: number,
): RectBox {
  return {
    left: host.left + (rect.left - host.left) / scale,
    top: host.top + (rect.top - host.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/**
 * The scale at which a sheet `paperWidth` CSS px wide (816 for Letter, 794 for
 * A4, as upstream sets `--ws-width`) is shown in a panel `available` CSS px
 * wide.
 *
 * Pure display policy: the page plan is the same at every scale (see
 * {@link unzoomRect}), so this decides only how big the paper looks. It keeps
 * a gutter on each side wide enough for the sheet's drop shadow
 * (`box-shadow: 5px 10px 40px -10px` in print-worksheet.css reaches ~35px to
 * the right), and never enlarges the sheet past its true size — a wide panel
 * shows it at 100%, centred. The floor only keeps the scale positive (and the
 * rect correction finite) in an absurdly narrow panel.
 *
 * Self-contained, as it is embedded in the page via `toString()`.
 */
export function printFitZoom(available: number, paperWidth: number): number {
  const gutter = 36;
  return Math.max(0.1, Math.min(1, (available - 2 * gutter) / paperWidth));
}

/**
 * Show the print layout at true paper size, scaled to fit the panel.
 *
 * Runs in the page (embedded via `toString()`, as live-patch.ts does), so it
 * reaches nothing outside its parameters and touches the page only through
 * `win`. Two parts:
 *
 * - **The rect correction**, installed once per `Window`: inside a scaled
 *   `.printout`, `getBoundingClientRect()` answers in unscaled layout space,
 *   so pretext-core.js — which cannot be hooked, being one IIFE — plans the
 *   same pages at any panel width. Patched on the prototype, so the flag
 *   stops a second delivery into the same `Window` stacking a second wrapper.
 *   Inert outside print preview: only print preview has a `.printout`, and
 *   only with this CSS does it carry a transform.
 * - **The fit**, per delivered document: a `ResizeObserver` on `<html>` (and
 *   on the printout once it exists, for a paper-size switch or a
 *   repagination) re-computes the scale, and the margin that takes back the
 *   height the scaled printout leaves empty.
 *
 * The panel's width is read off `<html>`, not off the printout's container:
 * a container sized by its content would size itself by the paper, and the
 * scale would then never shrink below 1.
 */
export function installPrintFit(
  win: Window & typeof globalThis & { __ptxPrintFitPatched?: boolean },
  fitZoom: (available: number, paperWidth: number) => number,
  unzoom: (rect: RectBox, host: RectBox, scale: number) => RectBox,
  property: string,
  shrinkProperty: string,
): void {
  const doc = win.document;
  if (
    !win.Element ||
    !win.DOMRect ||
    !win.DOMMatrixReadOnly ||
    !win.getComputedStyle ||
    !doc
  ) {
    return;
  }
  if (!win.__ptxPrintFitPatched) {
    win.__ptxPrintFitPatched = true;
    const original = win.Element.prototype.getBoundingClientRect;
    win.Element.prototype.getBoundingClientRect = function (this: Element) {
      const rect = original.call(this);
      const host = this.closest ? this.closest(".printout") : null;
      if (!host) {
        return rect;
      }
      // Read off the style rather than remembered from the fit: in print
      // media the transform rule does not apply, and neither must the
      // correction.
      const transform = win.getComputedStyle(host).transform;
      if (!transform || transform === "none") {
        return rect;
      }
      const scale = new win.DOMMatrixReadOnly(transform).a;
      if (!scale || scale === 1) {
        return rect;
      }
      const box = unzoom(rect, original.call(host), scale);
      return new win.DOMRect(box.left, box.top, box.width, box.height);
    };
  }
  if (!win.ResizeObserver) {
    return;
  }
  const root = doc.documentElement;
  // Only on a change: an unchanged write still costs a style recalc, and what
  // it applies can re-trigger the observer.
  const set = (name: string, value: string) => {
    if (root.style.getPropertyValue(name) !== value) {
      root.style.setProperty(name, value);
    }
  };
  let watched: Element | null = null;
  const observer = new win.ResizeObserver(() => {
    const printout = doc.querySelector<HTMLElement>(".printout");
    if (!printout || !printout.offsetWidth) {
      return;
    }
    if (printout !== watched) {
      watched = printout;
      observer.observe(printout);
    }
    // Offsets are layout sizes, which the transform leaves alone.
    const scale = fitZoom(root.clientWidth, printout.offsetWidth);
    set(property, String(scale));
    set(shrinkProperty, `${(scale - 1) * printout.offsetHeight}px`);
  });
  observer.observe(root);
}

/**
 * Sentinel comments bracketing what this module injects, so a later injection
 * finds and replaces its predecessor instead of piling up beside it (mirrors
 * {@link injectRevealBridge}'s own sentinel).
 */
const INJECTED_OPEN = "<!--ptx-print-preview-->";
const INJECTED_CLOSE = "<!--/ptx-print-preview-->";
const INJECTED_BLOCK =
  /\n?<!--ptx-print-preview-->[\s\S]*?<!--\/ptx-print-preview-->/;

/**
 * Deliver a rendered page in the print-preview layout for one of its printouts,
 * or — with no id — in the ordinary layout.
 *
 * Inject into `<head>`, ahead of pretext-core.js: the patch has to be in place
 * before that script's DOMContentLoaded handler *runs*, and being earlier in
 * the document is the simplest way to be sure of it.
 *
 * An id that is not a printout on this page is treated as no id at all. That is
 * not merely defensive: pretext-core.js swaps in the print stylesheet *before*
 * it looks the element up, so a stale id — one left over from the previously
 * previewed file, say — would leave the reader on a print-styled page with no
 * printout on it.
 *
 * Returns the page with the bridge removed (never with a half-applied one) when
 * there is no `<head>` to inject into, which would mean the page is not a
 * PreTeXt render at all.
 */
export function injectPrintPreview(html: string, printoutId?: string): string {
  // Replace rather than append: a page handed back by renderHtml may already
  // carry a block, and toggling print preview re-injects over exactly that.
  const existing = INJECTED_BLOCK.exec(html);
  const base = existing
    ? html.slice(0, existing.index) +
      html.slice(existing.index + existing[0].length)
    : html;

  const head = /<head[^>]*>/i.exec(base);
  if (!head) {
    return base;
  }
  const wanted =
    printoutId &&
    listPrintouts(base).some((printout) => printout.id === printoutId)
      ? printoutId
      : undefined;
  // The paper styling goes in only for the print layout — the ordinary page
  // keeps its theme — and after the script, so a page that was delivered in
  // print preview a moment ago drops it again along with the rest of the block.
  const injected =
    `\n${INJECTED_OPEN}\n${printPreviewBridgeScript(wanted)}\n` +
    `${wanted ? `${printPreviewCss()}\n` : ""}${INJECTED_CLOSE}`;
  const end = head.index + head[0].length;
  return base.slice(0, end) + injected + base.slice(end);
}
