/**
 * The iframe pages of a rendered document's interactives.
 *
 * PreTeXt does not draw an `<interactive platform="…">` — GeoGebra, JSXGraph,
 * D3, Sage, DoenetML, plain JavaScript, and `<interactive geogebra="…">`,
 * which assembly rewrites into the platform form — on the page it appears on.
 * The page gets an `<iframe src="<id>-if.html">`, and a second, minimal page
 * of that name holds the slates, the platform's libraries and the author's
 * scripts. A real build writes that page to a file next to the document.
 *
 * This renderer has no filesystem to write to. The preview stylesheets emit
 * each iframe page into the main result instead, inside an inert carrier
 * (`iframePageOverride` in scripts/refresh-xsl.mjs):
 *
 *     <template data-ptx-iframe-page="graph-if.html">
 *       <html>…</html>
 *       <!--/ptx-iframe-page-->
 *     </template>
 *
 * {@link extractIframePages} lifts the carriers back out, so the renderer can
 * return the pages by filename beside an HTML page that holds none of them.
 * What to do with them is the embedder's decision, because it is a decision
 * about trust: an iframe page runs JavaScript the author wrote.
 * {@link embedIframePages} is the ready-made answer for a host with nowhere to
 * serve files from — it inlines each page as its iframe's `srcdoc`, optionally
 * sandboxed.
 *
 * The interactives PreTeXt points straight at a service (`@desmos`,
 * `@calcplot3d`, `@circuitjs`, `@iframe`) have no page of their own and are
 * untouched by any of this.
 */

/** The attribute naming the file a carrier holds. See refresh-xsl.mjs. */
const PAGE_ATTRIBUTE = "data-ptx-iframe-page";

/** The comment that closes a carrier's page. See refresh-xsl.mjs. */
const PAGE_END = "<!--/ptx-iframe-page-->";

/** A carrier's start tag; the filename is the one capture. */
const CARRIER_START = new RegExp(`<template ${PAGE_ATTRIBUTE}="([^"]*)">`, "g");

/** The end of a carrier: its closing comment, then the end tag. */
const CARRIER_END = new RegExp(`${PAGE_END}\\s*</template>`, "g");

/** Iframe pages by filename, as an `<iframe>` on the main page names them. */
export type IframePages = Record<string, string>;

/**
 * Standards mode, as upstream's `exsl:document` asks for with
 * `doctype-system="about:legacy-compat"`. The carrier cannot hold a doctype.
 */
const DOCTYPE = "<!DOCTYPE html>\n";

function unescapeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Remove every iframe-page carrier from `html` and return the pages they
 * held, keyed by filename, each a complete HTML document.
 *
 * A carrier with no closing comment — truncated or hand-altered HTML — is left
 * where it is rather than guessed at: as a `<template>` it stays inert.
 */
export function extractIframePages(html: string): {
  html: string;
  pages: IframePages;
} {
  const pages: IframePages = {};
  let out = "";
  let last = 0;
  CARRIER_START.lastIndex = 0;
  for (
    let start = CARRIER_START.exec(html);
    start !== null;
    start = CARRIER_START.exec(html)
  ) {
    const contentStart = start.index + start[0].length;
    CARRIER_END.lastIndex = contentStart;
    const end = CARRIER_END.exec(html);
    if (end === null) {
      break;
    }
    pages[unescapeAttribute(start[1])] =
      DOCTYPE + html.slice(contentStart, end.index).trim() + "\n";
    out += html.slice(last, start.index);
    last = end.index + end[0].length;
    CARRIER_START.lastIndex = last;
  }
  return { html: out + html.slice(last), pages };
}

export interface EmbedIframePagesOptions {
  /**
   * A `sandbox` attribute to put on each iframe given a page, e.g.
   * `"allow-scripts"`. An iframe page runs the author's JavaScript, and a
   * `srcdoc` frame shares its embedder's origin unless it is sandboxed
   * without `allow-same-origin` — so a host that shows documents its user did
   * not write, on an origin that matters, should pass one. Omitted, the
   * iframe is left unsandboxed, as in a PreTeXt build.
   */
  sandbox?: string;
}

/** An `<iframe …>` start tag; the attributes are the one capture. */
const IFRAME_TAG = /<iframe\b([^>]*)>/g;

const SRC_ATTRIBUTE = /\ssrc="([^"]*)"/;

/**
 * Inline iframe pages into the page that frames them: every `<iframe>` whose
 * `src` names one of `pages` gets that page as its `srcdoc`.
 *
 * The `src` is replaced, not kept beside the `srcdoc`: it names a file that
 * does not exist, and a browser falls back to it when it does not honour
 * `srcdoc`. The filename moves to `data-ptx-iframe-page`, so a host can still
 * tell which page a frame shows.
 *
 * A `srcdoc` document resolves relative URLs against its embedder's base URL,
 * so an `external/…` script or stylesheet in a page loads from wherever the
 * main page's own assets do. To point those somewhere else, rewrite each page
 * (`rewriteAssetUrls`) before embedding it.
 *
 * An iframe naming no known page is left alone.
 */
export function embedIframePages(
  html: string,
  pages: IframePages,
  options: EmbedIframePagesOptions = {},
): string {
  if (Object.keys(pages).length === 0) {
    return html;
  }
  return html.replace(IFRAME_TAG, (tag, attributes: string) => {
    const src = SRC_ATTRIBUTE.exec(attributes);
    if (src === null) {
      return tag;
    }
    const name = unescapeAttribute(src[1]);
    if (!Object.hasOwn(pages, name)) {
      return tag;
    }
    const rest =
      attributes.slice(0, src.index) +
      attributes.slice(src.index + src[0].length);
    const sandbox =
      options.sandbox === undefined
        ? ""
        : ` sandbox="${escapeAttribute(options.sandbox)}"`;
    return (
      `<iframe${rest} ${PAGE_ATTRIBUTE}="${escapeAttribute(name)}"` +
      `${sandbox} srcdoc="${escapeAttribute(pages[name])}">`
    );
  });
}
