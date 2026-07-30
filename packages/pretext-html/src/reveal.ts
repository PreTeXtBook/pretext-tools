/**
 * View control for rendered reveal.js slideshows.
 *
 * A built deck opens as a presentation: one slide at a time, arrow keys to
 * advance. That is what an audience should see and a poor way to *write* a
 * deck — an author wants the whole thing at once, scrolling like every other
 * preview in the editor. reveal.js has exactly that built in (its "scroll
 * view"), and this module turns it on.
 *
 * ## Why a script, and why this one
 *
 * Reveal reads `view: 'scroll'` from the config passed to `Reveal.initialize`,
 * and only there: internally the activation runs once, from the routine that
 * fires after plugins load, so a later `Reveal.configure({view: 'scroll'})`
 * sets the value but activates nothing. The URL form (`?view=scroll`) is no
 * help either — the extension assigns `webview.html` directly, so there is no
 * query string of ours for reveal to parse.
 *
 * That leaves the config object, which PreTeXt writes into the page as a
 * literal at the end of the document. Rather than rewrite that literal — which
 * would bind us to its exact emitted text — {@link revealBridgeScript} wraps
 * `Reveal.initialize` itself and merges the overrides over whatever the deck
 * passes. The script is injected immediately after reveal.js's own `<script
 * src>`: classic scripts run in order, so it is guaranteed to see `Reveal`
 * defined and to run before the deck's initialize call.
 *
 * ## Switching views
 *
 * By re-rendering the page, not by talking to a live deck. The scroll view
 * restructures the DOM extensively and `Reveal.destroy()` does not fully undo
 * it, so a destroy/re-initialize toggle leaves debris. Since the embedder
 * already holds the rendered HTML, switching views is just re-injecting with
 * the other value and re-assigning it — no re-render, no reveal internals.
 */

/**
 * How a rendered deck is presented.
 *
 * - "slides" - reveal.js as built: one slide at a time. What an audience sees.
 * - "scroll" - the whole deck as one continuous scroll. Better for authoring.
 */
export type RevealView = "slides" | "scroll";

/** True when `value` is one of the {@link RevealView} strings. */
export function isRevealView(value: unknown): value is RevealView {
  return value === "slides" || value === "scroll";
}

/** Tuning for how a deck is laid out in the preview. */
export interface RevealViewOptions {
  /**
   * How large a deck's content is drawn, as a fraction of its presented size,
   * between 0.25 and 1. Zooming out shrinks the text rather than the slide —
   * the slide stays the same size on screen and more of its content fits
   * inside, which is the only way to read content that overflows a slide (see
   * {@link zoomedSlideSize}). Scroll view only. Defaults to
   * {@link DEFAULT_REVEAL_ZOOM}.
   */
  zoom?: number;
}

/**
 * Reveal's own nominal deck size, and the one its themes are designed around:
 * a 42px heading is 4.4% of a 960px-wide slide.
 *
 * PreTeXt publishes `width: "100%", height: "100%"` instead, and reveal
 * resolves a percentage against the *presentation element* — so the slide
 * becomes exactly as large as whatever it is being shown in, the computed
 * scale is always 1, and no downscaling ever happens. Full screen that is
 * fine. In an editor pane a few hundred pixels wide it means theme text sized
 * for a 960px slide is drawn at full size into a third of that width, which is
 * why an unadjusted deck previews enormously.
 *
 * Restoring the nominal size hands reveal something to scale *from*, so the
 * preview shows the same relative proportions a full-screen presentation
 * will. It also gives each slide a real, fixed box — which is what the slide
 * outlines below are drawn on.
 */
const SLIDE_WIDTH = 960;
const SLIDE_HEIGHT = 700;

/**
 * Zoom when the caller states none: the deck exactly as it will be presented.
 */
export const DEFAULT_REVEAL_ZOOM = 1;

/** How much of the pane is left as a gutter, so slide outlines are not flush. */
const SCROLL_VIEW_MARGIN = 0.04;

/**
 * The slide dimensions that render a deck's content at `zoom`.
 *
 * Zoom is expressed in slide units rather than screen pixels, which is the
 * only way to make it behave the way zooming out on a web page does. Reveal
 * scales a slide to fit the pane, and slide content is laid out in those same
 * units, so shrinking the *box* changes nothing about what fits inside it —
 * the same content overflows, and `.scroll-page-content` clips it with no way
 * to scroll to what was cut off. Enlarging the box instead leaves the rendered
 * slide the same size on screen (reveal simply scales it down further) while
 * the fixed-pixel text inside occupies proportionally less of it. So text gets
 * smaller and more of the slide's content becomes visible, which is what "zoom
 * out" ought to mean.
 *
 * At zoom 1 this is reveal's nominal size and the deck looks exactly as it will
 * when presented, overflow included — that being the honest answer to "does my
 * content fit on the slide?". Zooming out is how to read what did not.
 */
function zoomedSlideSize(zoom: number | undefined): {
  width: number;
  height: number;
} {
  const wanted =
    typeof zoom === "number" && isFinite(zoom) ? zoom : DEFAULT_REVEAL_ZOOM;
  const clamped = Math.min(1, Math.max(0.25, wanted));
  return {
    width: Math.round(SLIDE_WIDTH / clamped),
    height: Math.round(SLIDE_HEIGHT / clamped),
  };
}

/**
 * Reveal config overrides for the scroll view.
 *
 * Beyond `view` itself, these turn off the parts of a deck that only make
 * sense when presenting, and are the settings most worth revisiting — each is
 * a real authoring-vs-presenting trade-off:
 *
 * - `scrollLayout: "compact"` — reveal's default ("full") gives every slide a
 *   scroll page a full viewport tall, so slides are separated by screenfuls of
 *   nothing and only one is ever in view. Compact makes a page exactly as tall
 *   as the scaled slide, so slides stack and several are visible at once,
 *   which is the point of the scroll view for an author.
 * - `fragments: false` — `@pause="yes"` and `<subslide>` become reveal
 *   fragments, which in scroll view must each be scrolled through before the
 *   next slide. That is right when rehearsing and tedious when reading, so the
 *   scroll view shows every fragment at once and the presentation view keeps
 *   them. Toggling views is how you check your pauses. **Not sufficient on its
 *   own** — see {@link STRIP_FRAGMENTS_JS}.
 * - `scrollSnap: false` — reveal defaults to "mandatory", which snaps each
 *   slide to fill the viewport. That reads as paging rather than scrolling and
 *   fights any programmatic scrolling (which is what editor→preview sync
 *   does). Free scrolling suits a preview better.
 * - `scrollProgress: true` — the slide-dot rail is a cheap position indicator
 *   in a long deck, and it is the only navigation affordance left once the
 *   arrow controls are gone.
 * - `controls`/`controlsTutorial: false` — the arrow UI navigates slides, and
 *   in scroll view there is nothing for it to do.
 * - `hash: false` — the deck asks for `hash: true`, which writes `#/2/1` via
 *   `history.replaceState`. In a webview that is a `vscode-webview://` origin
 *   and the call can throw; there is also no URL for a reader to come back to.
 */
function scrollViewConfig(options: RevealViewOptions): Record<string, unknown> {
  return {
    view: "scroll",
    scrollLayout: "compact",
    scrollSnap: false,
    scrollProgress: true,
    fragments: false,
    controls: false,
    controlsTutorial: false,
    hash: false,
    ...zoomedSlideSize(options.zoom),
    margin: SCROLL_VIEW_MARGIN,
  };
}

/** Reveal config overrides for the ordinary presentation view. */
function slidesViewConfig(): Record<string, unknown> {
  return {
    // Explicitly null rather than absent: the same page may have been
    // delivered in scroll view a moment ago, and an embedder that re-injects
    // over already-injected HTML would otherwise leave the old value standing.
    view: null,
    // See scrollViewConfig; the webview objection to hash applies either way.
    hash: false,
    // The nominal size matters just as much here: a deck previewed at pane
    // size with a percentage width renders its text far larger, relative to
    // the slide, than the same deck will on a projector. No zoom margin
    // though — presenting means filling whatever it is shown in.
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
  };
}

/**
 * Outlines around each slide in the scroll view, so it is obvious where one
 * ends and the next begins.
 *
 * Drawn on the `section` reveal positions inside each scroll page, because
 * that element alone is the slide's true rectangle — reveal gives it the exact
 * `--slide-width`/`--slide-height` and then scales it by `--slide-scale`,
 * which is set on the viewport and so inherits down to it. The width is
 * divided back out by that scale, keeping the line hairline-thin however far
 * the deck is zoomed out.
 *
 * An **inset box-shadow**, specifically. `outline` is the obvious choice and
 * silently loses the top and bottom edges: reveal nests the slide in
 * `.scroll-page-content`, which is `overflow: hidden`, and compact layout makes
 * the page exactly the scaled slide height — so the slide is flush against its
 * own clipping boundary, and an outline (painted *outside* the border box) is
 * clipped away. Only the left and right edges, where the gutter leaves room,
 * survive. A `border` would be painted inside but is part of the box model, and
 * the section's dimensions are set by reveal, so it would resize the slide. An
 * inset shadow is painted inside the border box and affects no layout at all.
 *
 * The colour is a mid grey at half alpha, which reads on reveal's light themes
 * (simple, white) and its dark ones (black, night) alike without having to
 * know which is in force.
 */
const SLIDE_OUTLINE_CSS = [
  "<style>",
  ".reveal-viewport.reveal-scroll .scroll-page section {",
  "  box-shadow: inset 0 0 0 calc(1px / var(--slide-scale, 1))",
  "    rgba(128, 128, 128, 0.5);",
  "}",
  "</style>",
].join("\n");

/**
 * Statements that strip the `fragment` class off every paused element, run
 * just before `Reveal.initialize` in the scroll view.
 *
 * `fragments: false` is not enough, and the reason is worth recording. The
 * scroll view builds its scroll steps in `createFragmentTriggersForPage`,
 * which does `querySelectorAll('.fragment')` and never looks at
 * `config.fragments`. So the config setting makes fragments *visible* (the
 * fragments plugin marks them `disabled`) while reveal goes on creating one
 * scroll trigger per fragment, and each trigger adds a full
 * `scrollTriggerHeight` of scroll padding to the page.
 *
 * Compact layout then makes it markedly worse. Reveal chooses the page height
 * with, in effect,
 *
 *     compact && page.scrollTriggers.length > 0 ? viewportHeight : slideHeight
 *
 * so a slide with even one fragment loses compact sizing altogether and gets a
 * full-viewport page *plus* the padding. A slide with two pauses ends up about
 * three screens tall.
 *
 * Removing the class is what actually settles it: with no `.fragment` in the
 * page, no triggers are created, compact sizing applies, and the slide is one
 * screen like any other. Safe to do here because the presentation view is
 * reached by re-injecting into the renderer's pristine HTML, never by undoing
 * this on a live page.
 */
const STRIP_FRAGMENTS_JS = [
  "    var paused = document.querySelectorAll('.reveal .fragment');",
  "    for (var i = 0; i < paused.length; i++) {",
  "      paused[i].classList.remove('fragment');",
  "    }",
];

/**
 * The inline `<script>` (as a string) that applies `view` to a rendered deck.
 *
 * Written in ES5-ish, self-contained JS: it is embedded verbatim in the output
 * page, so no bundler runs over it, and it re-executes on every in-place
 * `document.write` rebuild the extension performs.
 */
export function revealBridgeScript(
  view: RevealView,
  options: RevealViewOptions = {},
): string {
  const overrides =
    view === "scroll" ? scrollViewConfig(options) : slidesViewConfig();
  return [
    "<script>",
    "(function () {",
    "  var OVERRIDES = " + JSON.stringify(overrides) + ";",
    // Nothing to wrap if reveal.js failed to load (offline, CDN blocked). The
    // deck is broken either way, but throwing here would replace the browser's
    // useful network error with a confusing one from an injected script.
    "  if (typeof Reveal === 'undefined' || !Reveal.initialize) { return; }",
    // Guard against double-wrapping: an embedder may inject into HTML that was
    // already injected into, and wrapping a wrapper would still work but grows
    // a chain on every redelivery.
    "  if (Reveal.__ptxViewWrapped) {",
    "    Reveal.__ptxViewOverrides = OVERRIDES;",
    "    return;",
    "  }",
    "  Reveal.__ptxViewWrapped = true;",
    "  Reveal.__ptxViewOverrides = OVERRIDES;",
    "  var initialize = Reveal.initialize.bind(Reveal);",
    "  Reveal.initialize = function (config) {",
    "    var merged = {};",
    "    var key;",
    "    for (key in config || {}) { merged[key] = config[key]; }",
    "    var o = Reveal.__ptxViewOverrides;",
    "    for (key in o) { merged[key] = o[key]; }",
    // Inside the wrapper rather than at top level: this script sits in <head>,
    // where the slides have not been parsed yet, but the deck calls initialize
    // from the end of the document, by which time they have.
    ...(view === "scroll" ? STRIP_FRAGMENTS_JS : []),
    "    return initialize(merged);",
    "  };",
    "})();",
    "</script>",
  ].join("\n");
}

/**
 * Matches the `<script src="…/reveal.js">` tag PreTeXt emits into the deck's
 * `<head>`. Kept loose about the host so it still matches if the publication
 * file points reveal.js somewhere other than the default CDN.
 */
const REVEAL_SCRIPT_TAG =
  /<script\b[^>]*\bsrc=["'][^"']*\breveal\.js["'][^>]*>\s*<\/script>/i;

/**
 * Sentinel comments bracketing everything this module injects, so a later
 * injection can find and replace its predecessor instead of piling up beside
 * it. Comments rather than an id or data attribute because the block holds two
 * unrelated elements (a style and a script), and a wrapper element around them
 * would change where the script sits relative to reveal.js.
 */
const INJECTED_OPEN = "<!--ptx-reveal-view-->";
const INJECTED_CLOSE = "<!--/ptx-reveal-view-->";
const INJECTED_BLOCK =
  /\n?<!--ptx-reveal-view-->[\s\S]*?<!--\/ptx-reveal-view-->/;

/**
 * Inject the view bridge into a rendered slideshow, immediately after
 * reveal.js's own `<script src>`.
 *
 * Returns the page unchanged when that tag is not found — which means either
 * the page is not a deck, or upstream has changed how reveal.js is loaded. In
 * both cases the deck still works, just in its built-in view, and a silently
 * ordinary slideshow is a far better outcome than a thrown error in a preview.
 */
export function injectRevealBridge(
  html: string,
  view: RevealView,
  options: RevealViewOptions = {},
): string {
  // Replacing rather than appending, so switching views is idempotent: a page
  // handed back by renderHtml has already been injected once, and an embedder
  // that toggles views re-injects over exactly that. Appending would leave a
  // stale <style> behind on every toggle. The script's own double-wrap guard
  // is not enough on its own — it protects the wrapper, not the markup.
  const existing = INJECTED_BLOCK.exec(html);
  const base = existing
    ? html.slice(0, existing.index) +
      html.slice(existing.index + existing[0].length)
    : html;

  const match = REVEAL_SCRIPT_TAG.exec(base);
  if (!match) {
    return base;
  }
  const end = match.index + match[0].length;
  // The outline rules are scoped to .reveal-scroll, which only the scroll view
  // sets, so they can go in for either view rather than being toggled.
  const injected =
    `\n${INJECTED_OPEN}\n${SLIDE_OUTLINE_CSS}\n` +
    `${revealBridgeScript(view, options)}\n${INJECTED_CLOSE}`;
  return base.slice(0, end) + injected + base.slice(end);
}
