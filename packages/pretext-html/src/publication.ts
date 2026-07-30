/**
 * Publication-file handling for single-page preview builds.
 *
 * The preview relies on PreTeXt's "portable HTML" mode
 * (`<html><platform portable="yes"/></html>` in the publication file), which
 * forces chunk level 0 (the whole document on one page), serves css/js from
 * the jsDelivr CDN, and suppresses most auxiliary file output. Publisher
 * variables can only come from a publication file — there is no stringparam
 * for `portable` — so we rewrite the user's publication file (or synthesize a
 * minimal one) and serve it through the fetch shim as a virtual file.
 *
 * That rewrite is also how an embedder's default HTML theme gets in
 * (`<html><css theme="..."/></html>`): same reason, no stringparam for it
 * either, short of `debug.html.theme-name`.
 *
 * Slideshow renders go through the same rewrite for the same reason, plus one
 * of their own: reveal.js resources may be published locally or embedded into
 * the page, and neither exists for an in-memory build (see
 * {@link forceRevealResources}).
 */

import { fromXml } from "xast-util-from-xml";
import { toXml } from "xast-util-to-xml";
import type { Element, Root } from "xast";
import type { RenderTarget } from "./target.js";

const MINIMAL_PUBLICATION = `<?xml version="1.0" encoding="UTF-8"?>
<publication>
  <source>
    <directories external="../assets" generated="../generated-assets" />
  </source>
  <html>
    <platform portable="yes"/>
  </html>
</publication>
`;

/**
 * Attributes on `<html><css/>` by which a project states which HTML theme it
 * wants. `@theme` is the current spelling; `@style` and `@shell` are the
 * deprecated ones publisher-variables.xsl still maps onto a theme (warning as
 * it goes). Any of them means the project has made a choice, so a
 * caller-supplied default stays out of the way.
 */
const THEME_ATTRIBUTES = ["theme", "style", "shell"] as const;

function findChildElement(
  parent: Root | Element,
  name: string,
): Element | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.name === name) {
      return child;
    }
  }
  return undefined;
}

function ensureChildElement(parent: Root | Element, name: string): Element {
  let child = findChildElement(parent, name);
  if (!child) {
    child = { type: "element", name, attributes: {}, children: [] };
    parent.children.push(child);
  }
  return child;
}

/**
 * Declare `<css theme="..."/>` under `<html>`, unless the publication file
 * already names a theme of its own (see {@link THEME_ATTRIBUTES}) — this is a
 * fallback, not an override.
 */
function applyDefaultCssTheme(html: Element, cssTheme: string): void {
  const existing = findChildElement(html, "css");
  if (
    existing &&
    THEME_ATTRIBUTES.some((name) => existing.attributes?.[name])
  ) {
    return;
  }
  const css = existing ?? ensureChildElement(html, "css");
  css.attributes = { ...css.attributes, theme: cssTheme };
}

/**
 * Declare `<appearance theme="..."/>` under `<revealjs>`, unless the
 * publication file already names one. A fallback, not an override — the same
 * contract as {@link applyDefaultCssTheme}, and a different setting entirely:
 * reveal.js decks are styled by reveal's own themes, not PreTeXt's.
 */
function applyDefaultRevealTheme(revealjs: Element, revealTheme: string): void {
  const existing = findChildElement(revealjs, "appearance");
  if (existing?.attributes?.["theme"]) {
    return;
  }
  const appearance = existing ?? ensureChildElement(revealjs, "appearance");
  appearance.attributes = { ...appearance.attributes, theme: revealTheme };
}

/**
 * Force `<revealjs><resources host="cdn" math="online"/></revealjs>`.
 *
 * Unlike the theme defaults, this overrides the project outright, because the
 * two alternatives it displaces cannot work here:
 *
 * - `host="local"` points reveal.js at a `dist/` tree copied next to the built
 *   slideshow. Nothing is copied anywhere for an in-memory render, so every
 *   stylesheet and script would 404 and the deck would not run at all.
 * - `host="embedded"` emits the same CDN URLs but expects the `pretext/pretext`
 *   script to inline the file contents afterwards, which nothing does here.
 *
 * `math` is forced along with it: it defaults to "embedded" whenever the host
 * is embedded, and embedded mathematics is a set of prebuilt SVG images passed
 * in through the `mathfile` parameter by the Python toolchain. Without that
 * file the deck renders with its mathematics simply missing — silently, which
 * is worse than the styling being off. "online" loads MathJax from the CDN,
 * which the preview can do.
 */
function forceRevealResources(revealjs: Element): void {
  const resources = ensureChildElement(revealjs, "resources");
  resources.attributes = {
    ...resources.attributes,
    host: "cdn",
    math: "online",
  };
}

/** Optional adjustments layered onto the publication file for a render. */
export interface PublicationOverrides {
  /**
   * Fallback PreTeXt HTML theme for projects that name none; see
   * `RenderOptions.cssTheme`. A blank value is ignored.
   */
  cssTheme?: string;
  /**
   * Fallback reveal.js theme for slideshows that name none; see
   * `RenderOptions.revealTheme`. Only consulted when `target` is "slides".
   */
  revealTheme?: string;
  /**
   * Which conversion this publication file is being prepared for. "slides"
   * additionally forces the reveal.js resource host; see
   * {@link forceRevealResources}. Defaults to "html".
   */
  target?: RenderTarget;
}

/**
 * Return publication-file XML with `<html><platform portable="yes"/></html>`
 * forced, preserving everything else from `publicationXml` when given.
 *
 * Portable mode is forced for slideshows too, even though the reveal.js
 * conversion never chunks: it is what sets `$cdn-prefix`, and so what puts the
 * PreTeXt-side css and js (sagecell, syntax highlighting, the slide styling)
 * on the CDN rather than at a relative path that does not exist.
 */
export function forcePortablePublication(
  publicationXml?: string,
  overrides: PublicationOverrides = {},
): string {
  const cssTheme = overrides.cssTheme?.trim();
  const revealTheme = overrides.revealTheme?.trim();
  const slides = overrides.target === "slides";
  if (!publicationXml && !cssTheme && !slides) {
    return MINIMAL_PUBLICATION;
  }
  const tree = fromXml(publicationXml ?? MINIMAL_PUBLICATION);
  const publication = findChildElement(tree, "publication");
  if (!publication) {
    throw new Error(
      "Invalid publication file: no root <publication> element found",
    );
  }
  const html = ensureChildElement(publication, "html");
  const platform = ensureChildElement(html, "platform");
  platform.attributes = { ...platform.attributes, portable: "yes" };
  if (cssTheme) {
    applyDefaultCssTheme(html, cssTheme);
  }
  if (slides) {
    const revealjs = ensureChildElement(publication, "revealjs");
    forceRevealResources(revealjs);
    if (revealTheme) {
      applyDefaultRevealTheme(revealjs, revealTheme);
    }
  }
  return toXml(tree);
}

/**
 * Where a project's images live, as declared by
 * `<source><directories external generated/></source>`.
 *
 * Both paths are relative to the directory of the *main* source file — the one
 * holding `<pretext>` — not to whichever file is being rendered. See
 * RenderOptions.mainSourcePath.
 */
export interface AssetDirectories {
  /** e.g. "../assets/" — trailing slash, relative to the main source dir. */
  external?: string;
  /** e.g. "../generated-assets/" — likewise. */
  generated?: string;
  /**
   * True when the publication declares both attributes ("managed
   * directories"). Only then does PreTeXt emit asset URLs under the fixed
   * `external/` and `generated/` prefixes that {@link rewriteAssetUrls} keys
   * on; legacy projects emit bare or `images/`-prefixed paths that cannot be
   * told apart from anything else, so the preview leaves them alone.
   */
  managed: boolean;
}

/**
 * Normalise one `@external`/`@generated` value the way publisher-variables.xsl
 * does: a leading "/" is an error (treated as unset), and a non-empty value
 * gains a trailing slash.
 */
function normalizeDirectory(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "" || raw.startsWith("/")) {
    return undefined;
  }
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/**
 * Read the asset directories from a publication file, falling back to the
 * defaults baked into MINIMAL_PUBLICATION when none is supplied.
 */
export function readAssetDirectories(
  publicationXml?: string,
): AssetDirectories {
  const tree = fromXml(publicationXml ?? MINIMAL_PUBLICATION);
  const publication = findChildElement(tree, "publication");
  const source = publication && findChildElement(publication, "source");
  const directories = source && findChildElement(source, "directories");
  const external = normalizeDirectory(
    directories?.attributes?.["external"] ?? undefined,
  );
  const generated = normalizeDirectory(
    directories?.attributes?.["generated"] ?? undefined,
  );
  // PreTeXt only switches on managed directories when *both* are declared;
  // one alone is a publication-file error it warns about and ignores.
  return {
    external,
    generated,
    managed: external !== undefined && generated !== undefined,
  };
}
