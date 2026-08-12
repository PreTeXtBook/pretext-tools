/**
 * Reconcile a subtree render's links with the single page it actually
 * produced.
 *
 * A fragment preview is rendered with upstream's `subtree` parameter: the
 * whole document is assembled — so numbering is right and every `<xref>`
 * finds its target — but only one division is emitted. The links, though, are
 * written for the multi-page build that assembling implies. PreTeXt hands back
 * `sec-two.html#thm-b` for a theorem in another section, `sec-one.html#thm-a`
 * for one on this very page, and a bare `sec-three.html` for each table of
 * contents entry. None of those files exist: there is one page, in memory.
 *
 * Two fixes, from one question — is the target on this page?
 *
 *   - **On the page.** Rewrite to a bare `#id`. The link then does exactly
 *     what the built book's would: scroll to the target. Answering by looking
 *     for the `id` in the rendered HTML, rather than by reasoning about
 *     PreTeXt's filename scheme, means this cannot drift when that scheme
 *     changes, and it costs one pass over the page.
 *
 *   - **Not on the page.** Drop the `@href` and explain in a tooltip. A link
 *     that silently does nothing is worse than an obvious non-link, and the
 *     reader has no other way to learn that the preview is showing one section
 *     of something larger. The element, its classes and its text are all left
 *     alone, so the page still reads like the built one — the same tactic, and
 *     the same `aria-disabled` spelling, as the inert print-preview button in
 *     preview-html.xsl (see PRINTOUT_LINK_OVERRIDE in scripts/refresh-xsl.mjs).
 *
 * Applied to the rendered HTML rather than in the stylesheet because the
 * question cannot be answered during the transform: whether a target lands on
 * the page is a fact about the finished output, and upstream computes every
 * URL through `mode="url"` from a dozen call sites. One pass over the result
 * is one rule that cannot fall out of step with them.
 */

/** Default tooltip on a link whose target is not on the previewed page. */
export const OFF_PAGE_MESSAGE =
  "This live preview shows a single division, so links into the rest of the document do not work here.";

export interface RewriteXrefLinkOptions {
  /**
   * Tooltip for a link whose target is not on this page. Defaults to
   * {@link OFF_PAGE_MESSAGE}. When the link already carries a tooltip — an
   * `<xref>` is given one naming its target, like "Theorem 2.1: Beta" — the
   * two are joined rather than the original being thrown away.
   */
  offPageMessage?: string;
}

/** `<a ...>`, capturing its attributes. */
const ANCHOR_TAG = /<a\b([^>]*)>/g;

/** Every `id="..."` in the page: the set of targets a `#fragment` can reach. */
const ID_ATTRIBUTE = /\sid="([^"]*)"/g;

/** `href="..."`, and the same inside a MathJax `\href{...}` macro. */
const HREF_ATTRIBUTE = /\shref="([^"]*)"/;
const MATHJAX_HREF = /\\href\{([^{}]*)\}/g;

/** `title="..."`, whose value becomes part of the off-page tooltip. */
const TITLE_ATTRIBUTE = /\stitle="([^"]*)"/;

/** Collect the ids the rendered page defines. */
function pageIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const match of html.matchAll(ID_ATTRIBUTE)) {
    ids.add(match[1]);
  }
  return ids;
}

/**
 * Escape plain text for an HTML attribute.
 *
 * Applied only to the caller's message. A title already on the page came out
 * of the transform escaped — a division titled `"Q" & A` arrives as
 * `&quot;Q&quot; &amp; A` — so escaping it again would show the entities to
 * the reader instead of the title.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * What a URL means for this page: a same-page anchor to `id`, an off-page
 * destination, or something to leave alone (external links, `#`-only anchors,
 * `javascript:` and the like).
 */
function classify(
  url: string,
  ids: Set<string>,
): { kind: "same-page"; id: string } | { kind: "off-page" } | { kind: "keep" } {
  // Already a bare fragment, or a non-navigational href: upstream's own
  // in-page anchors ("#", "#ptx-content") and every absolute URL.
  if (url.startsWith("#") || url === "") return { kind: "keep" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) {
    return { kind: "keep" };
  }
  const hash = url.indexOf("#");
  if (hash === -1) return { kind: "off-page" };
  const id = url.slice(hash + 1);
  return ids.has(id) && id !== ""
    ? { kind: "same-page", id }
    : { kind: "off-page" };
}

/**
 * Point every link in `html` at something real: same-page targets become
 * `#id`, and links leaving the page become inert with an explanatory tooltip.
 *
 * Safe to run on any rendered page. A whole-document preview emits only
 * same-page anchors and absolute URLs, so nothing matches and the HTML comes
 * back unchanged.
 */
export function rewriteXrefLinks(
  html: string,
  options: RewriteXrefLinkOptions = {},
): string {
  const message = options.offPageMessage ?? OFF_PAGE_MESSAGE;
  const ids = pageIds(html);

  const rewritten = html.replace(ANCHOR_TAG, (tag, attributes: string) => {
    const href = HREF_ATTRIBUTE.exec(attributes);
    if (!href) return tag;
    const verdict = classify(href[1], ids);
    if (verdict.kind === "keep") return tag;
    if (verdict.kind === "same-page") {
      return `<a${attributes.replace(HREF_ATTRIBUTE, ` href="#${verdict.id}"`)}>`;
    }
    // Off the page: strip the href so the link cannot navigate, and say why.
    const existingTitle = TITLE_ATTRIBUTE.exec(attributes);
    const explanation = escapeAttribute(message);
    const tooltip = existingTitle
      ? `${existingTitle[1]} — ${explanation}`
      : explanation;
    const withoutHref = attributes.replace(HREF_ATTRIBUTE, "");
    const withoutTitle = withoutHref.replace(TITLE_ATTRIBUTE, "");
    return `<a${withoutTitle} title="${tooltip}" aria-disabled="true" style="cursor:default">`;
  });

  // Cross-references authored inside display math are rendered by MathJax from
  // a `\href{url}{text}` macro, not from an anchor. Same-page ones are worth
  // repointing; an off-page one has no tooltip to carry, so it is left as the
  // dead link it already was rather than being silently rewritten to nothing.
  return rewritten.replace(MATHJAX_HREF, (macro, url: string) => {
    const verdict = classify(url, ids);
    return verdict.kind === "same-page" ? `\\href{#${verdict.id}}` : macro;
  });
}
