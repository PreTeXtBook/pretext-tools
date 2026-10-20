/**
 * Publication-file handling for single-page preview builds.
 *
 * A preview is one page, rendered in memory, with no output directory beside
 * it. Four publisher settings make an ordinary HTML build fit that, and the
 * preview forces all four (see {@link PREVIEW_SETTINGS}):
 *
 * - `<html><resources host="cdn"/>` serves PreTeXt's css/js, the theme and
 *   the icon font from the jsDelivr CDN, since there is no `_static/` to copy
 *   them into.
 * - `<common><chunking level="0"/>` puts the whole document on one page.
 * - `<html><cross-references knowled="never"/>` renders every `<xref>` as a
 *   link, because the knowl files a cross-reference knowl opens are separate
 *   files that an in-memory build never writes.
 * - `<html><platform portable="no"/>` keeps PreTeXt's "portable HTML" mode off,
 *   even for a project that builds portable.
 *
 * Portable mode would do the first three in one switch, and the preview used
 * to rely on it. It also inlines every latex-image and PreFigure SVG into the
 * page, read at transform time. Without it those images are `<img>` links into
 * the generated directory, like every other asset. A host then serves them the
 * same way it serves the rest (see assets.ts), and a host without a filesystem
 * (a browser editor) needs no image files available during the render.
 *
 * Publisher variables can only come from a publication file, so we rewrite the
 * user's publication file (or synthesize a minimal one) and serve it through
 * the fetch shim as a virtual file.
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
  <common>
    <tableofcontents level="0"/>
  </common>
</publication>
`;

/**
 * The publisher settings every preview build forces, as
 * `[path to element, attribute, value]`. They override the project's own
 * choices, because each alternative needs files written next to the page. See
 * the module comment for what each one does.
 *
 * `chunking` is a `common` setting, not an `html` one, so it also reaches the
 * reveal.js conversion. That conversion never chunks, so it is inert there.
 */
const PREVIEW_SETTINGS: ReadonlyArray<
  readonly [location: readonly string[], attribute: string, value: string]
> = [
  [["html", "resources"], "host", "cdn"],
  [["html", "platform"], "portable", "no"],
  [["html", "cross-references"], "knowled", "never"],
  [["common", "chunking"], "level", "0"],
];

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
 * Return publication-file XML with the preview's settings forced (see
 * {@link PREVIEW_SETTINGS}), preserving everything else from `publicationXml`
 * when given.
 *
 * The CDN host is forced for slideshows too: it is what sets `$cdn-prefix`, and
 * so what puts the PreTeXt-side css and js (sagecell, syntax highlighting, the
 * slide styling) on the CDN rather than at a relative path that does not
 * exist.
 */
export function forcePreviewPublication(
  publicationXml?: string,
  overrides: PublicationOverrides = {},
): string {
  const cssTheme = overrides.cssTheme?.trim();
  const revealTheme = overrides.revealTheme?.trim();
  const slides = overrides.target === "slides";
  const tree = fromXml(publicationXml ?? MINIMAL_PUBLICATION);
  const publication = findChildElement(tree, "publication");
  if (!publication) {
    throw new Error(
      "Invalid publication file: no root <publication> element found",
    );
  }
  for (const [location, attribute, value] of PREVIEW_SETTINGS) {
    const element = location.reduce<Element>(
      (parent, name) => ensureChildElement(parent, name),
      publication,
    );
    element.attributes = { ...element.attributes, [attribute]: value };
  }
  const html = ensureChildElement(publication, "html");
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
 * The previous name of {@link forcePreviewPublication}, from when the preview
 * forced PreTeXt's portable HTML mode.
 *
 * @deprecated Use {@link forcePreviewPublication}. The preview no longer uses
 * portable mode, so the name no longer describes what this does.
 */
export const forcePortablePublication = forcePreviewPublication;

/**
 * Where a project's images live. PreTeXt emits every asset URL under one of
 * two fixed prefixes, `external/` and `generated/`, and these are the
 * directories those prefixes stand for.
 *
 * Both paths are relative to the directory of the *main* source file — the one
 * holding `<pretext>` — not to whichever file is being rendered. See
 * RenderOptions.mainSourcePath.
 */
export interface AssetDirectories {
  /**
   * e.g. "../assets/" — trailing slash, relative to the main source dir.
   * Undefined when nothing declares one, which upstream reads as "this
   * project has no external assets".
   */
  external?: string;
  /**
   * e.g. "../generated-assets/" — likewise. Always set: the directory is
   * machine-owned, so an undeclared one defaults to "generated/" beside the
   * source.
   */
  generated: string;
}

/** Where PreTeXt looks for generated assets when nothing says otherwise. */
const DEFAULT_GENERATED_DIRECTORY = "generated/";

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

/** The depths a publication file sets numbering and the contents list to. */
export interface PublicationLevels {
  /** `common/tableofcontents/@level`. */
  tocLevel?: number;
  /**
   * The deepest of `numbering/{blocks,projects,equations,footnotes,figures,
   * ...}/@level` — the families share one default, but a publisher may set
   * them apart, and a preview must keep what the deepest of them counts.
   */
  numberingLevel?: number;
  /** `numbering/divisions/@level`, which caps every other numbering level. */
  maxNumberingLevel?: number;
}

function levelAttribute(element: Element | undefined): number | undefined {
  const raw = element?.attributes?.["level"];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const level = Number(raw);
  return Number.isFinite(level) && level >= 0 ? level : undefined;
}

/**
 * Read the numbering and table-of-contents depths from a publication file —
 * the ones that decide how much of a document a division preview has to keep
 * (see skeleton.ts). Absent entries are left undefined for the skeleton to
 * default by the document's structure, exactly as publisher-variables.xsl
 * does. Falls back to MINIMAL_PUBLICATION when none is supplied.
 */
export function readPublicationLevels(
  publicationXml?: string,
): PublicationLevels {
  const tree = fromXml(publicationXml ?? MINIMAL_PUBLICATION);
  const publication = findChildElement(tree, "publication");
  const common = publication && findChildElement(publication, "common");
  const toc = common && findChildElement(common, "tableofcontents");
  const numbering = publication && findChildElement(publication, "numbering");
  let numberingLevel: number | undefined;
  let maxNumberingLevel: number | undefined;
  for (const child of numbering?.children ?? []) {
    if (child.type !== "element") continue;
    const level = levelAttribute(child);
    if (level === undefined) continue;
    if (child.name === "divisions") {
      maxNumberingLevel = level;
    } else {
      numberingLevel = Math.max(numberingLevel ?? 0, level);
    }
  }
  return {
    tocLevel: levelAttribute(toc),
    numberingLevel,
    maxNumberingLevel,
  };
}

/**
 * Read the asset directories the way PreTeXt resolves them (as of 2026-08,
 * when managed directories became the only scheme):
 *
 * - **external** is a property of the source. The document's
 *   `<docinfo><directories external="..."/>` wins; the publication file's
 *   `source/directories/@external` is the deprecated fallback; with neither,
 *   the project has no external assets.
 * - **generated** is a publication setting, `source/directories/@generated`,
 *   and defaults to "generated/" beside the source.
 *
 * `docinfoExternal` is the raw `@external` from the document's docinfo, which
 * the caller reads from the source (see {@link docinfoExternalDirectory}). The
 * publication file falls back to MINIMAL_PUBLICATION when none is supplied.
 */
export function readAssetDirectories(
  publicationXml?: string,
  docinfoExternal?: string,
): AssetDirectories {
  const tree = fromXml(publicationXml ?? MINIMAL_PUBLICATION);
  const publication = findChildElement(tree, "publication");
  const source = publication && findChildElement(publication, "source");
  const directories = source && findChildElement(source, "directories");
  const attribute = (name: string): string | undefined => {
    const value = directories?.attributes?.[name];
    return value === null || value === undefined ? undefined : String(value);
  };
  const external =
    docinfoExternal !== undefined
      ? normalizeDirectory(docinfoExternal)
      : normalizeDirectory(attribute("external"));
  const generated =
    normalizeDirectory(attribute("generated")) ?? DEFAULT_GENERATED_DIRECTORY;
  return external === undefined ? { generated } : { external, generated };
}

/**
 * The raw `directories/@external` of a document's `<docinfo>`, or undefined
 * when it declares none. `root` is a parsed document (whose `<pretext>` holds
 * the docinfo), or a `<docinfo>` on its own — parsed, or as the XML string a
 * fragment preview is given. Only the docinfo's direct `<directories>` child
 * counts, as upstream's `$version-root/docinfo/directories` does.
 *
 * A string that does not parse declares nothing here; the transform reports
 * the malformed docinfo itself.
 */
export function docinfoExternalDirectory(
  root: Root | string,
): string | undefined {
  if (typeof root === "string") {
    try {
      return docinfoExternalDirectory(fromXml(root));
    } catch {
      return undefined;
    }
  }
  const top = root.children.find(
    (node): node is Element => node.type === "element",
  );
  const docinfo =
    top?.name === "docinfo" ? top : top && findChildElement(top, "docinfo");
  const directories = docinfo && findChildElement(docinfo, "directories");
  const value = directories?.attributes?.["external"];
  return value === null || value === undefined ? undefined : String(value);
}
