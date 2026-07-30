/**
 * Which PreTeXt conversion a render drives.
 *
 * The two share almost everything — the same assembly passes, the same
 * publication file, the same portable/CDN resource handling — and differ in
 * the stylesheet they enter through:
 *
 *   "html"   - assets/preview-html.xsl, wrapping pretext-html.xsl.
 *   "slides" - assets/preview-revealjs.xsl, wrapping pretext-revealjs.xsl,
 *              for a `<slideshow>` document rendered as a reveal.js deck.
 *
 * A document is one or the other by its type, not by the author's choosing, so
 * the renderer detects it (see {@link detectRenderTarget}) unless a caller says
 * otherwise.
 */
export type RenderTarget = "html" | "slides";

/**
 * Which conversion `xml` calls for: "slides" if it is a `<slideshow>` — or a
 * piece of one, so that previewing a single xi:included file of slides still
 * builds a deck — and "html" otherwise.
 *
 * Deliberately a scan rather than a parse: this runs on every render, on
 * xinclude-merged source that can be megabytes, and parsing the whole tree to
 * look at element names costs far more than the question is worth. The scan is
 * sound because neither tag is ambiguous in PreTeXt: `<slideshow>` is a
 * document type, appearing only as a child of `<pretext>`, and `<slide>`
 * appears only within one. Neither has a homonym elsewhere in the vocabulary.
 *
 * Comments and CDATA are stripped first. A commented-out `<slideshow>`, or a
 * document about PreTeXt quoting the markup, is unlikely — but it would
 * misroute the *entire* render, which is far too large a failure to leave to
 * chance for the cost of two replaces.
 */
export function detectRenderTarget(xml: string): RenderTarget {
  const stripped = xml
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ");
  // The trailing class is what keeps <slideshowish> (or any other element
  // merely starting with these letters) from matching.
  return /<\s*slide(?:show)?[\s/>]/.test(stripped) ? "slides" : "html";
}
