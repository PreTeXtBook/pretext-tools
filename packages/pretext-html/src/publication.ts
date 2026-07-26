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
 */

import { fromXml } from "xast-util-from-xml";
import { toXml } from "xast-util-to-xml";
import type { Element, Root } from "xast";

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
 * Return publication-file XML with `<html><platform portable="yes"/></html>`
 * forced, preserving everything else from `publicationXml` when given.
 *
 * `cssTheme`, when given, supplies `<html><css theme="..."/></html>` for
 * projects that do not choose an HTML theme themselves; see
 * `RenderOptions.cssTheme`. A blank value is ignored.
 */
export function forcePortablePublication(
  publicationXml?: string,
  cssTheme?: string,
): string {
  const theme = cssTheme?.trim();
  if (!publicationXml && !theme) {
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
  if (theme) {
    applyDefaultCssTheme(html, theme);
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
