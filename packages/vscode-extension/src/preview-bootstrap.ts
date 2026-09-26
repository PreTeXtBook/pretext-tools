/**
 * Scripts for the live preview's webview page that do not depend on the
 * `vscode` module, so they can be unit-tested in jsdom (see
 * preview-bootstrap.spec.ts). instantPreview.ts splices them into every page
 * it delivers.
 */

import { LIVE_PATCH_GLOBAL } from "@pretextbook/pretext-html/live-patch";

/** Height of the injected mode toolbar; the theme offsets below match it. */
export const TOOLBAR_HEIGHT_PX = 32;

/**
 * Toolbar wiring, spliced into each page's bootstrap IIFE (so it can use the
 * `api` handle already established there) as the body of `ptxWireToolbar`.
 * Runs after every in-place document rewrite, and after every patch — which
 * replaces the toolbar whole when its markup changed — hence the per-element
 * `__ptxWired` guard.
 */
export const TOOLBAR_SCRIPT_LINES: string[] = [
  "  var bar = document.getElementById('ptx-tools-bar');",
  "  if (bar && !bar.__ptxWired) {",
  "    bar.__ptxWired = true;",
  "    bar.addEventListener('click', function (event) {",
  "      var el = event.target;",
  "      var btn = el && el.closest ? el.closest('button') : null;",
  "      if (!btn) { return; }",
  "      var mode = btn.getAttribute('data-ptx-mode');",
  "      if (mode) {",
  "        api.postMessage({ command: 'setMode', mode: mode });",
  "        return;",
  "      }",
  "      var action = btn.getAttribute('data-ptx-action');",
  "      if (!action) { return; }",
  // Flip the checkbox here rather than waiting for the extension to persist
  // the setting and echo it back; the round trip is visible as lag on a
  // control that should feel instant. The 'follow' message below reconciles
  // if the setting is changed from anywhere else.
  "      if (action === 'toggleFollow') {",
  "        var on = btn.getAttribute('aria-pressed') !== 'true';",
  "        btn.setAttribute('aria-pressed', on ? 'true' : 'false');",
  "        api.postMessage({ command: 'setFollow', follow: on });",
  "        return;",
  "      }",
  // Same reasoning as the follow toggle: the deck is about to be replaced
  // wholesale, but until it is the pressed button should already look pressed.
  "      if (action === 'slidesScroll' || action === 'slidesPresent') {",
  "        var want = action === 'slidesScroll' ? 'scroll' : 'slides';",
  "        bar.setAttribute('data-slides-view', want);",
  "        var seg = btn.parentNode.querySelectorAll('button');",
  "        for (var i = 0; i < seg.length; i++) {",
  "          seg[i].setAttribute('aria-pressed', seg[i] === btn ? 'true' : 'false');",
  "        }",
  "      }",
  "      api.postMessage({ command: action });",
  "    });",
  // The print-preview menu is a <select>, so it reports through 'change'
  // rather than the click handler above. Nothing to update optimistically: the
  // extension answers by delivering a whole new page, selection included.
  "    bar.addEventListener('change', function (event) {",
  "      var select = event.target;",
  "      if (!select || select.id !== 'ptx-tools-printout-select') { return; }",
  "      api.postMessage({ command: 'setPrintout', id: select.value });",
  "    });",
  "  }",
];

/** The `status` message branch, spliced into each page's message handler. */
export const TOOLBAR_STATUS_BRANCH: string[] = [
  "    if (msg.command === 'status') {",
  "      var statusEl = document.getElementById('ptx-tools-status');",
  "      if (statusEl) { statusEl.textContent = msg.text || ''; }",
  "      return;",
  "    }",
  // Keeps the checkbox honest when the setting is changed from the Settings
  // UI or another window, rather than from this toolbar.
  "    if (msg.command === 'follow') {",
  "      var followEl = document.querySelector(",
  "        '[data-ptx-action=\"toggleFollow\"]');",
  "      if (followEl) {",
  "        followEl.setAttribute('aria-pressed', msg.on ? 'true' : 'false');",
  "      }",
  "      return;",
  "    }",
];

/**
 * The live page's bootstrap: a `<style>` and an inline `<script>`, appended
 * to the end of `<body>`.
 *
 * Runs once per document, including documents written by the update path
 * below (the extension injects this same script into every rendered page).
 * acquireVsCodeApi may only be called once per webview *session*, and
 * document.write keeps the same Window, so the api handle is stashed on
 * window. Likewise the old message listener survives the rewrite in some
 * engines, so it is explicitly removed before re-adding.
 */
export function liveBootstrapScript(): string {
  return [
    // Faint amber flash on the element the forward sync scrolls to; the
    // animation fades to nothing so the page returns to normal on its own.
    "<style>",
    "@keyframes ptx-sync-flash {",
    "  from { background-color: rgba(255, 193, 61, 0.18);",
    "         box-shadow: 0 0 0 5px rgba(255, 193, 61, 0.18); }",
    "  to   { background-color: transparent; box-shadow: none; }",
    "}",
    ".ptx-sync-flash { animation: ptx-sync-flash 1.6s ease-out;",
    "  border-radius: 4px; }",
    "</style>",
    "<script>",
    "(function () {",
    "  var api = window.__ptxPreviewApi ||",
    "    (window.__ptxPreviewApi = acquireVsCodeApi());",
    "  var prior = api.getState();",
    "  function restoreScroll() {",
    "    if (prior && typeof prior.scrollY === 'number') {",
    "      window.scrollTo(0, prior.scrollY);",
    "    }",
    "  }",
    "  restoreScroll();",
    "  window.addEventListener('load', restoreScroll);",
    "  var ticking = false;",
    "  window.addEventListener('scroll', function () {",
    "    if (ticking) { return; }",
    "    ticking = true;",
    "    setTimeout(function () {",
    "      api.setState({ scrollY: window.scrollY });",
    "      ticking = false;",
    "    }, 100);",
    "  });",
    "  if (window.__ptxUpdateHandler) {",
    "    window.removeEventListener('message', window.__ptxUpdateHandler);",
    "  }",
    "  window.__ptxUpdateHandler = function (event) {",
    "    var msg = event.data;",
    "    if (!msg) { return; }",
    ...TOOLBAR_STATUS_BRANCH,
    "    if (msg.command === 'scrollTo' && msg.ids && msg.ids.length) {",
    "      // Forward sync: try the id chain innermost-first; not every",
    "      // element in the source map gets an HTML id.",
    "      for (var k = 0; k < msg.ids.length; k++) {",
    "        var target = document.getElementById(msg.ids[k]);",
    "        if (target) {",
    "          // Center small elements; for anything too tall to fit (a",
    "          // subsection, a p with a long list) centering would push its",
    "          // top — the part that was clicked — above the viewport, so",
    "          // pin the top just below the window top instead.",
    "          var rect = target.getBoundingClientRect();",
    "          if (rect.height > window.innerHeight - 140) {",
    "            window.scrollTo(0, rect.top + window.pageYOffset - 70);",
    "          } else {",
    "            target.scrollIntoView({ block: 'center' });",
    "          }",
    "          if (window.__ptxFlashEl && window.__ptxFlashEl.classList) {",
    "            window.__ptxFlashEl.classList.remove('ptx-sync-flash');",
    "          }",
    "          void target.offsetWidth; // restart the fade animation",
    "          target.classList.add('ptx-sync-flash');",
    "          window.__ptxFlashEl = target;",
    "          break;",
    "        }",
    "      }",
    "      return;",
    "    }",
    "    if (msg.command !== 'update' || typeof msg.html !== 'string') {",
    "      return;",
    "    }",
    "    if (typeof msg.previous === 'string') {",
    "      window.__ptxRawHtml = msg.previous;",
    "      window.__ptxRawDoc = null;",
    "    }",
    "    if (msg.patch && ptxTryPatch(msg.html)) {",
    "      return;",
    "    }",
    // The rewritten page is the one the next patch diffs against. Kept on
    // window because document.write keeps the Window (see above).
    "    window.__ptxRawHtml = msg.html;",
    "    window.__ptxRawDoc = null;",
    "    api.setState({ scrollY: window.scrollY });",
    "    document.open();",
    "    document.write(msg.html);",
    "    document.close();",
    "  };",
    "  window.addEventListener('message', window.__ptxUpdateHandler);",
    // Patch the new page into this one (see @pretextbook/pretext-html's
    // live-patch): only changed blocks are replaced, so the scroll position,
    // typeset math and opened proofs all stay. Diffs the previous page's HTML
    // against the new, both pristine — the live DOM has been rewritten by
    // MathJax and friends since. False means the caller must rewrite instead.
    "  function ptxTryPatch(html) {",
    `    var patcher = window[${JSON.stringify(LIVE_PATCH_GLOBAL)}];`,
    "    if (!patcher || typeof window.__ptxRawHtml !== 'string') {",
    "      return false;",
    "    }",
    "    try {",
    "      var parser = new DOMParser();",
    "      var oldDoc = window.__ptxRawDoc ||",
    "        parser.parseFromString(window.__ptxRawHtml, 'text/html');",
    "      var newDoc = parser.parseFromString(html, 'text/html');",
    "      var result = patcher.patchDocument(document, oldDoc, newDoc);",
    "      api.postMessage({ command: 'patchResult', ok: result.ok,",
    "        reason: result.reason, changed: result.added.length });",
    "      if (!result.ok) { return false; }",
    "      window.__ptxRawHtml = html;",
    "      window.__ptxRawDoc = newDoc;",
    "      patcher.typeset(window, result);",
    "      ptxWireToolbar();",
    "      ptxOffsetPinned();",
    "      return true;",
    "    } catch (err) {",
    "      console.error('PreTeXt preview: live patch failed', err);",
    "      api.postMessage({ command: 'patchResult', ok: false,",
    "        reason: 'the patch failed: ' + err });",
    "      return false;",
    "    }",
    "  }",
    "  // Reverse sync: report a double-clicked element's ancestor id chain",
    "  // (innermost first); the extension resolves it against the source map.",
    "  if (window.__ptxSyncClickHandler) {",
    "    window.removeEventListener('dblclick', window.__ptxSyncClickHandler);",
    "  }",
    "  window.__ptxSyncClickHandler = function (event) {",
    "    var ids = [];",
    "    var el = event.target;",
    "    while (el && el.getAttribute && ids.length < 8) {",
    "      var id = el.getAttribute('id');",
    "      if (id) { ids.push(id); }",
    "      el = el.parentElement;",
    "    }",
    "    if (ids.length) {",
    "      api.postMessage({ command: 'revealSource', ids: ids });",
    "    }",
    "  };",
    "  window.addEventListener('dblclick', window.__ptxSyncClickHandler);",
    "  function ptxWireToolbar() {",
    ...TOOLBAR_SCRIPT_LINES,
    "  }",
    "  ptxWireToolbar();",
    // The navbar and ToC sidebar are pinned by the theme at offsets it
    // computes itself, so there is no fixed value to override in CSS — and
    // more importantly, whether they are pinned to the *top* at all depends on
    // the viewport: PreTeXt's narrow-screen layout parks the navigation at the
    // bottom. So measure what the theme actually decided and only add the
    // toolbar's height to things it put at the top. Clearing our own value
    // first makes this idempotent, which matters because it re-runs on resize
    // when the layout flips between the wide and narrow arrangements.
    `  var PTX_BAR_H = ${TOOLBAR_HEIGHT_PX};`,
    "  function ptxOffsetPinned() {",
    "    var ids = ['ptx-navbar', 'ptx-sidebar'];",
    "    for (var i = 0; i < ids.length; i++) {",
    "      var el = document.getElementById(ids[i]);",
    "      if (!el) { continue; }",
    "      el.style.removeProperty('top');",
    "      var cs = window.getComputedStyle(el);",
    "      if (cs.position !== 'sticky' && cs.position !== 'fixed') {",
    "        continue;",
    "      }",
    "      if (cs.top === 'auto') { continue; }",
    "      var base = parseFloat(cs.top);",
    "      if (isNaN(base)) { continue; }",
    "      // Bottom-anchored bars stay put even if they resolve a numeric top.",
    "      var rect = el.getBoundingClientRect();",
    "      if (rect.top > window.innerHeight / 2) { continue; }",
    "      // 'important' because the theme sets these with it too.",
    "      el.style.setProperty('top', (base + PTX_BAR_H) + 'px', 'important');",
    "    }",
    "  }",
    "  ptxOffsetPinned();",
    "  window.addEventListener('load', ptxOffsetPinned);",
    "  if (window.__ptxResizeHandler) {",
    "    window.removeEventListener('resize', window.__ptxResizeHandler);",
    "  }",
    "  window.__ptxResizeHandler = function () {",
    "    if (window.__ptxResizeTimer) {",
    "      clearTimeout(window.__ptxResizeTimer);",
    "    }",
    "    window.__ptxResizeTimer = setTimeout(ptxOffsetPinned, 100);",
    "  };",
    "  window.addEventListener('resize', window.__ptxResizeHandler);",
    "})();",
    "</script>",
  ].join("\n");
}
