/**
 * Expand born-hidden knowls in a rendered preview.
 *
 * PreTeXt draws "born-hidden" blocks — solutions, hints, answers, and whatever
 * else the publication file elects to hide — as a native `<details>` with the
 * heading in a clickable `<summary>` and the content collapsed (see
 * `mode="born-hidden"` in pretext-html.xsl). On a built page that is the point:
 * the reader chooses what to reveal.
 *
 * In a live preview it works against the author. Editing a solution re-renders
 * the page, and the fresh HTML has that solution collapsed again — so the one
 * thing the author is looking at is the one thing they cannot see. Opening the
 * knowls up front is what makes edit-and-watch work.
 *
 * Only `.born-hidden-knowl` is touched. The other `<details>` PreTeXt emits —
 * footnotes, image descriptions, diagcess instructions, the print-options panel
 * — are left collapsed, so the preview still reads like the built page.
 *
 * Done on the rendered HTML rather than in the preview stylesheet because a
 * `<details>` is emitted from five separate upstream templates: an XSLT
 * override would mean copying all five into the generated wrapper and keeping
 * every one of them in step with upstream. Matching the class is one rule that
 * cannot drift. Escaped text (a code sample showing `<details>`) is `&lt;` in
 * the output and so cannot match.
 *
 * Safe with upstream's javascript: `SlideRevealer` in pretext-core.js binds a
 * click handler that branches on whether the element already has `@open`, so a
 * pre-opened knowl animates *closed* on the first click, exactly as it would
 * had the reader opened it themselves.
 */

/** Class pretext-html.xsl puts on every born-hidden knowl's `<details>`. */
const KNOWL_CLASS = "born-hidden-knowl";

/**
 * `<details ...>` optionally followed by its `<summary ...>`. The two are
 * captured together so the summary can be marked open as well (see
 * {@link openBornHiddenKnowls}); upstream always emits the summary as the
 * details' first child, but a details with none is still opened.
 */
const DETAILS_TAG = /<details\b([^>]*)>(\s*)(?:<summary\b([^>]*)>)?/g;

/** The classes named by an attribute string, e.g. ` id="x" class="a b"`. */
function classList(attributes: string): string[] {
  const match = /\bclass="([^"]*)"/.exec(attributes);
  return match ? match[1].trim().split(/\s+/) : [];
}

/** True when `attributes` already carries a bare or valued `open`. */
function hasOpen(attributes: string): boolean {
  return /(^|\s)open(\s|=|$)/.test(attributes);
}

function withOpen(attributes: string): string {
  return hasOpen(attributes) ? attributes : ` open${attributes}`;
}

/**
 * Add `@open` to every born-hidden knowl in `html`, leaving all other
 * `<details>` alone.
 *
 * The knowl's `<summary>` is marked open too. That mirrors what pretext-core.js
 * does when a reader clicks one (`triggerElement.setAttribute("open", "")`) and
 * is what the theme's `.knowl__link:is(:hover,:focus,[open])` rule keys on for
 * the summary's tinted background — without it a pre-opened knowl would be the
 * only open knowl on the page whose heading is not highlighted. It is not a
 * valid HTML attribute on `<summary>`; it is upstream's convention, matched
 * here so the preview looks like the page a reader opened by hand.
 */
export function openBornHiddenKnowls(html: string): string {
  return html.replace(
    DETAILS_TAG,
    (match, detailsAttrs: string, gap: string, summaryAttrs?: string) => {
      if (!classList(detailsAttrs).includes(KNOWL_CLASS)) {
        return match;
      }
      const details = `<details${withOpen(detailsAttrs)}>`;
      if (summaryAttrs === undefined) {
        return `${details}${gap}`;
      }
      return `${details}${gap}<summary${withOpen(summaryAttrs)}>`;
    },
  );
}
