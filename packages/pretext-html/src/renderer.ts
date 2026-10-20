/**
 * PreTeXt → HTML in pure JavaScript.
 *
 * Runs the official, unmodified PreTeXt XSLT 1.0 stylesheets with
 * libxslt-wasm (a WebAssembly build of libxml2/libxslt/libexslt — the same C
 * libraries the Python CLI uses via lxml), plus a thin generated wrapper
 * stylesheet that emits the whole document as one complete HTML page in
 * memory. See assets/preview-html.xsl and scripts/refresh-xsl.mjs.
 *
 * Requires WebAssembly JSPI (stack switching). In Node this currently means
 * the `--experimental-wasm-jspi` flag; the `pretext-html` CLI re-launches
 * itself with the flag automatically.
 */

import * as path from "node:path";
import { injectPreviewBanner, type PreviewBannerOptions } from "./banner.js";
import { assetsBase, joinPath, readMount } from "./host.js";
import {
  HTML_STATIC_VERSION,
  RUNESTONE_CSS,
  RUNESTONE_JS,
  RUNESTONE_VERSION,
} from "./html-static.js";
import { openBornHiddenKnowls } from "./knowls.js";
import { mountDirectory, setVirtualFile, unmountDirectory } from "./mounts.js";
import {
  injectPrintPreview,
  listPrintouts,
  rootPrintoutId,
  type PrintoutInfo,
} from "./printout.js";
import {
  docinfoExternalDirectory,
  forcePreviewPublication,
  readAssetDirectories,
  readPublicationLevels,
} from "./publication.js";
import { injectRevealBridge, type RevealView } from "./reveal.js";
import { computeSourceMap, type PtxSourceMap } from "./sourcemap.js";
import { detectRenderTarget, type RenderTarget } from "./target.js";
import { injectThemeBridge, type PreviewTheme } from "./theme.js";
import {
  extractDocinfo,
  readWith,
  resolveXIncludesToTree,
  tagIncludedFile,
  type ResolveOptions,
  type SourceReader,
} from "./xinclude.js";
import { buildSkeleton, replaceDivision } from "./skeleton.js";
import { SourceCache } from "./source-cache.js";
import {
  countElements,
  ensureXmlId,
  selectDivision,
  type SubtreeOptions,
} from "./subtree.js";
import { isStructural } from "./skeleton.js";
import { rewriteXrefLinks } from "./xrefs.js";
import { toXml } from "xast-util-to-xml";
import type { Element, Root } from "xast";

/**
 * How a document is read: the options every entry point that reads source
 * shares — {@link renderHtml} and {@link measureDocument}.
 */
export interface SourceOptions {
  /** Path to the root PreTeXt source file (typically source/main.ptx). */
  sourcePath: string;
  /**
   * Source text to transform instead of reading `sourcePath` from disk.
   * `sourcePath` is still used to resolve relative xi:includes. Lets callers
   * render unsaved editor content.
   */
  sourceContent?: string;
  /**
   * Directory served to the transform for xi:includes and relative
   * references. Defaults to the directory containing `sourcePath`. Set it to
   * the project root when the publication file or includes live outside the
   * source directory. Files outside this directory are not readable by the
   * transform.
   */
  projectDir?: string;
  /**
   * Supply the files the document refers to — xi:include targets, the
   * context document, the publication file, the docinfo source — from
   * somewhere other than the platform: an in-memory project in a browser,
   * an editor's unsaved buffers. Called with each file's absolute, normalized
   * path; `undefined` falls through to the platform's own read (disk under
   * Node, an absolute URL in the browser), so the reader can overlay just a
   * few files or stand in for a filesystem entirely. See {@link SourceReader}.
   *
   * This is what lets the browser build resolve `xi:include`s at all, and
   * what the per-file parse cache (`cache`) keys on: hand it the same string
   * for an unchanged file and that file is not parsed again.
   */
  readSource?: SourceReader;
  /**
   * The same as `readSource`, as a map from absolute path to content, for
   * hosts whose project simply is such a map. Consulted before `readSource`.
   */
  files?: Record<string, string>;
  /**
   * Reuse the parse of every file whose content has not changed since the
   * last render (see source-cache.ts). On by default, with one cache shared
   * by every render in the process; pass a {@link SourceCache} to scope it
   * (one per project, say, so `invalidate()` has a clear meaning), or
   * `false` to parse everything afresh each time.
   *
   * What it buys: a fragment preview placed in its document
   * (`contextSourcePath`) and a division preview of a complete document
   * (`subtree`) both parse the *whole* document to prune it to a skeleton;
   * with the cache, a keystroke re-parses only the file being edited.
   */
  cache?: SourceCache | false;
}

export interface RenderOptions extends SourceOptions {
  /**
   * Path to the project's *main* source file — the one holding `<pretext>`.
   * Defaults to `sourcePath`, which is correct whenever a complete document is
   * being rendered.
   *
   * PreTeXt anchors the publication file's relative asset directories
   * (`source/directories/@external|@generated`) at this file's directory, and
   * so does every `document()` the stylesheets make. Rendering a fragment from
   * a subdirectory therefore needs it: previewing `source/chapters/ch1.ptx`
   * must still resolve `../generated-assets/` from `source/`, not from
   * `source/chapters/`. Without it, generated images silently render empty.
   */
  mainSourcePath?: string;
  /**
   * Preview one division of the document instead of all of it — the one
   * around the author's cursor (`line`, and `file` when that is not the file
   * being rendered) or the one carrying an `id` — numbered and
   * cross-referenced exactly as the whole document would be, by the same
   * skeleton pruning a fragment placed in its document gets (see
   * skeleton.ts). The cost of a render then tracks the division, not the
   * document, which is what makes previewing a large single-file book as
   * you type feasible at all.
   *
   * `level` chooses the page by PreTeXt's chunk-level rules, and
   * `wholeDocumentUpTo` keeps small documents previewing whole; see
   * {@link SubtreeOptions}. With `fragment` and a context document, the
   * selection is made within the placed fragment (so a cursor line narrows
   * the preview to the subsection it is in); without `subtree` the fragment's
   * own root is the division, as before.
   *
   * Ignored when no division can be selected — the document then renders
   * whole, and {@link RenderResult.subtree} is absent.
   */
  subtree?: SubtreeOptions;
  /**
   * Path to a publication file. Its settings are respected except the few a
   * one-page, in-memory build cannot honour, which the preview forces: css/js
   * from the CDN, chunk level 0, cross-references as links rather than knowls,
   * and portable mode off. See publication.ts.
   */
  publicationPath?: string;
  /**
   * PreTeXt HTML theme to fall back on, inserted into the publication file
   * used for the build as `<html><css theme="..."/></html>`.
   *
   * A default, not an override: it applies only when the project's own
   * publication file names no theme (neither `@theme` nor the deprecated
   * `@style`/`@shell`), so a project that has chosen one keeps it. Blank is
   * ignored, and with no publication file at all it themes the synthesized
   * minimal one.
   *
   * Previews load `theme-<name>.min.css` from the CDN, so an
   * unrecognised name renders an unstyled page. The themes the vendored
   * stylesheets know are default-modern (PreTeXt's own default), denver,
   * tacoma, salem, greeley and boulder; `custom` additionally needs a locally
   * compiled stylesheet, which this renderer cannot produce.
   *
   * Distinct from {@link RenderOptions.theme}, which is the light/dark mode
   * *within* whichever css theme is in force.
   */
  cssTheme?: string;
  /**
   * Which conversion to run. Defaults to detecting it from the document: a
   * `<slideshow>` renders as a reveal.js deck, anything else as ordinary HTML.
   * Set it explicitly to override the detection — most usefully in fragment
   * mode, where a lone `<section>` of slides is ambiguous.
   */
  target?: RenderTarget;
  /**
   * How a slideshow is presented: "scroll" for the whole deck as one
   * continuous page (the useful default for authoring), "slides" for reveal's
   * ordinary one-slide-at-a-time presentation. Ignored for non-slideshows.
   *
   * Switching later needs no re-render: `injectRevealBridge` applies the other
   * value to the HTML already returned. Defaults to "scroll".
   */
  revealView?: RevealView;
  /**
   * How large a deck's content is drawn in the scroll view, as a fraction of
   * its presented size (0.25 to 1, default 1).
   *
   * Zooming out shrinks the *text*, not the slide: the slide stays the same
   * size on screen and more of its content fits inside it. That is what makes
   * content overflowing a slide readable at all — reveal clips it, so at full
   * size there is no way to see what was cut off. Ignored when presenting.
   */
  revealZoom?: number;
  /**
   * reveal.js theme to fall back on for slideshows whose publication file
   * names none, inserted as `<revealjs><appearance theme="..."/></revealjs>`.
   * A default, not an override, exactly like {@link RenderOptions.cssTheme}.
   *
   * These are reveal's own themes, not PreTeXt's — "simple" (reveal's default
   * here), "white", "black", "league", "night", "moon", and so on — and they
   * are loaded from the CDN by name, so an unrecognised one renders unstyled.
   *
   * Note that {@link RenderOptions.theme} does nothing for a slideshow: a deck
   * loads none of the PreTeXt javascript that implements light/dark mode. A
   * dark reveal theme is how an embedder gets a dark deck.
   */
  revealTheme?: string;
  /**
   * Additional XSLT string parameters, passed as strings (quoted for you).
   * These are applied last, so they also override the defaults every render
   * sets — see DEFAULT_STRING_PARAMS.
   */
  stringParams?: Record<string, string>;
  /** Directory of PreTeXt XSL stylesheets. Defaults to the vendored copy. */
  xslDir?: string;
  /**
   * Allow rendering a file that is not a complete PreTeXt document. After
   * xi:includes are resolved, a fragment (a lone <section>, <chapter>, ...)
   * is wrapped in a minimal complete document — <pretext><book> for
   * <chapter>/<part> fragments, <pretext><article> otherwise — and built as
   * normal. Numbering restarts at the fragment and cross-references leaving the
   * fragment are unresolved; supply `docinfo` to restore the project's custom
   * LaTeX macros and settings. Complete documents are unaffected.
   */
  fragment?: boolean;
  /**
   * A `<docinfo>` element, as an XML string, to place inside the synthesized
   * <pretext> wrapper (before the <article>/<book>) when a fragment is
   * rendered. Lets a lone fragment keep the project's LaTeX macros, custom
   * settings, etc., that live in the real main file's docinfo. Only used in
   * fragment mode; complete documents carry their own docinfo and ignore this.
   * Takes precedence over `docinfoSourcePath`.
   */
  docinfo?: string;
  /**
   * Path to a complete PreTeXt source file (typically the project's main.ptx)
   * to lift the `<docinfo>` from for fragment mode, when `docinfo` is not
   * given. The docinfo is resolved through xi:includes — both a top-level
   * `<xi:include href="docinfo.ptx"/>` and includes nested inside docinfo —
   * which is how most projects factor it out. Only the docinfo is read, not
   * the book's chapters. Only used in fragment mode.
   */
  docinfoSourcePath?: string;
  /**
   * Path to the complete document (typically the project's main.ptx) that the
   * fragment being rendered belongs to. Renders the fragment **in place** in
   * that document instead of standalone, which is what makes its numbering and
   * its cross-references match the built book.
   *
   * A fragment rendered on its own restarts numbering at 1 and cannot see any
   * `<xref>` target outside itself, so previewing section 3.2 shows "Theorem
   * 1.1" where the book says "Theorem 3.2.1", and references leaving the
   * section render as PreTeXt's `[cross-reference to target(s) ... missing]`
   * placeholder. With this set, the document is pruned to a skeleton — every
   * division, the previewed fragment verbatim, and the divisions holding the
   * targets it references — and rendered with upstream's `subtree` parameter,
   * which emits only the previewed division. See skeleton.ts for why that
   * numbers identically to rendering the whole document, and for the cost.
   *
   * The fragment supplies its own content, so unsaved editor text is what gets
   * rendered; the document on disk supplies only the structure around it. That
   * matching is by `@xml:id`: a fragment whose root element has none, or whose
   * id is not in the document, silently falls back to the standalone wrapper.
   *
   * Supersedes `docinfoSourcePath`, since the skeleton carries the document's
   * real `<docinfo>`. Only used in fragment mode; ignored for whole documents.
   * Optional when `contextSourceContent` is given — see there — but still
   * used as the virtual base for xi:include resolution and source-map paths
   * even then, so pass it whenever a real path is available.
   */
  contextSourcePath?: string;
  /**
   * The complete document's source text, used instead of reading
   * `contextSourcePath` from disk. Lets a browser host that already holds the
   * whole project in memory place a fragment in its document — with
   * correct numbering and resolved `<xref>`s — without a filesystem or
   * network round trip, and lets the skeleton see *unsaved* sibling
   * divisions that a read from disk never would.
   *
   * `contextSourcePath` becomes optional when this is given, defaulting to
   * `sourcePath` as the virtual base for resolving the document's own
   * xi:includes; pass `contextSourcePath` too when a real one is available,
   * for more useful source-map/error paths. Exactly parallel to
   * `sourceContent` vs. `sourcePath`.
   */
  contextSourceContent?: string;
  /**
   * Tooltip for links whose target is not on the previewed page — the table of
   * contents, and cross-references reaching outside the fragment. Those cannot
   * navigate in a single-page preview, so they are stripped of their `@href`
   * and given this as an explanation (see xrefs.ts). Defaults to
   * {@link OFF_PAGE_MESSAGE}.
   *
   * Whole-document previews link only within the page, so nothing is affected.
   */
  offPageMessage?: string;
  /**
   * Also compute a source map: one entry per element, in document order,
   * mapping the element's @unique-id (its HTML id, when the page emits one)
   * to the file/line it was authored in — through xi:includes. Powers
   * editor/preview sync; the rendered page itself is unchanged. See
   * sourcemap.ts for the id contract with pretext-assembly.xsl.
   */
  sourceMap?: boolean;
  /**
   * Expand born-hidden knowls — solutions, hints, answers, and any block the
   * publication file elects to hide — instead of leaving them collapsed.
   * Defaults to **true**, because the pages this package renders are previews:
   * an author editing a solution needs to see it without re-opening it after
   * every re-render.
   *
   * Set it to false for a page meant to be read rather than authored against,
   * which is then collapsed exactly as a real PreTeXt build would be. Other
   * `<details>` (footnotes, image descriptions) are never affected. See
   * knowls.ts.
   */
  openKnowls?: boolean;
  /**
   * Let the embedding app control the preview's light/dark theme. When set, a
   * small bridge script is injected into the page that applies this value as
   * the initial theme and then follows `postMessage`s from the embedder (see
   * `previewThemeMessage` / theme.ts). Omit to leave the page's native
   * behaviour (localStorage + `prefers-color-scheme`) untouched — the output
   * is then byte-identical to a render without this option.
   */
  theme?: PreviewTheme;
  /**
   * Show a dismissible warning banner across the top of the page explaining
   * that this is a live preview, not a real build (see banner.ts). Omit to
   * leave the page without one — the output is then byte-identical to a
   * render without this option.
   *
   * The message is entirely the caller's: what the preview does not honour
   * reads differently depending on the embedder's own vocabulary (the VS
   * Code extension's "publication file" vs. pretext.plus's "build
   * settings"), so there is no default text here.
   */
  previewBanner?: PreviewBannerOptions;
  /**
   * Open the page in the print-preview layout for the printout with this HTML
   * id — paginated to a paper size, headers and footers, workspaces at their
   * true height (see printout.ts). The ids to choose from come back as
   * {@link RenderResult.printouts}; {@link RenderResult.rootPrintout} names the
   * one worth defaulting to.
   *
   * Omit for the ordinary layout, which leaves the output byte-identical to a
   * render without this option. An embedder that toggles the layout should
   * re-inject over the rendered HTML instead of re-rendering
   * (`injectPrintPreview`), which is both instant and — because it states the
   * *off* case explicitly — the only way to leave print preview in a host that
   * rewrites its document in place.
   */
  printPreview?: string;
}

/** How big a document is, as {@link measureDocument} reports it. */
export interface DocumentSize {
  /** Length of the xi:include-merged source, in UTF-16 code units. */
  bytes: number;
  /**
   * Number of elements in the merged source. The better predictor of render
   * time: PreTeXt's assembly walks the tree in a dozen passes, so cost tracks
   * nodes rather than text. For scale, a small article is a few hundred, a
   * long chapter a few thousand, a whole book tens of thousands.
   */
  elements: number;
  /**
   * Every file the document spans — the source first, then each xi:included
   * file in the order first reached. What to watch for changes.
   */
  files: string[];
}

export interface RenderResult {
  /** Complete standalone HTML page (CDN-hosted css/js/MathJax). */
  html: string;
  /**
   * The size of the document the render assembled — the whole context
   * document for a fragment placed in it, the whole document for a `subtree`
   * preview — before any pruning. What to compare against a threshold when
   * deciding how much of a document to preview next time.
   */
  size: DocumentSize;
  /**
   * Present when one division was emitted rather than the whole document:
   * `id` is its `xml:id`, which is also its HTML id on the page; `level` its
   * numbering level; `collapsed` whether the divisions nested inside it were
   * reduced to headings (see {@link SubtreeOptions.level}).
   */
  subtree?: {
    id: string;
    level: number;
    collapsed: boolean;
    /**
     * When `collapsed`, the ids of the divisions the summary page lists, in
     * document order — each the `xml:id` (authored or injected) its link
     * names in `data-ptx-division`, and its id in the source map. A host
     * following the cursor re-renders when it enters one of these. Empty
     * for a division shown whole.
     */
    children: string[];
  };
  /**
   * The conversion that actually ran — as asked for, or as detected. Lets an
   * embedder tell a deck from a document without re-inspecting the source,
   * which is what decides whether slideshow-only UI (the view toggle) applies.
   */
  target: RenderTarget;
  /** Present when RenderOptions.sourceMap was set. */
  sourceMap?: PtxSourceMap;
  /**
   * The page's printouts — worksheets, handouts, and projects with a workspace
   * — in document order, each of which can be shown in the print-preview
   * layout (see printout.ts). Empty when the document has none, which is also
   * when the page carries no print controls to drive that layout with.
   */
  printouts: PrintoutInfo[];
  /**
   * The printout to open in print preview by default, set when the rendered
   * document *is* a printout rather than merely containing some — previewing a
   * `worksheet.ptx`, whose root element is the `<worksheet>` itself. Undefined
   * otherwise, meaning the page should open in the ordinary layout.
   */
  rootPrintout?: string;
  /**
   * Absolute directories that the `external/` and `generated/` URL prefixes in
   * `html` refer to, resolved against the main source file's directory the way
   * PreTeXt resolves them (see readAssetDirectories). Feed these to
   * `rewriteAssetUrls` to point the page at assets the host can actually
   * serve (see assets.ts). That covers latex-image and PreFigure diagrams
   * too, which the page links like any other image.
   *
   * `generated` is always known, since an undeclared one defaults to
   * `generated/` beside the source. `external` is absent when neither the
   * docinfo nor the publication file declares it: the project then has no
   * external assets, and any `external/` URL in the page is a dangling
   * reference.
   */
  assetDirs: {
    external?: string;
    generated: string;
  };
}

/**
 * Vendored stylesheets shipped with this package. A directory under Node, a
 * base URL in the browser build — either way, a mount root (see host.ts).
 */
export function defaultXslDir(): string {
  return joinPath(assetsBase(), "xsl");
}

export function isJspiAvailable(): boolean {
  return "Suspending" in WebAssembly;
}

function assertJspi(): void {
  if (!isJspiAvailable()) {
    throw new Error(
      "WebAssembly JSPI is not enabled. Run Node with --experimental-wasm-jspi " +
        "(or use the pretext-html CLI, which re-launches itself with the flag).",
    );
  }
}

/** Quote a string as an XPath 1.0 string literal. */
export function xpathStringLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  // XPath 1.0 has no escaping; splice the single quotes in via concat().
  const parts = value.split("'").map((part) => `'${part}'`);
  return `concat(${parts.join(`, "'", `)})`;
}

/**
 * Work around the MathJax loader in pretext-html.xsl prefixing `./` to what
 * is an absolute CDN URL under CDN builds (pretext-html.xsl, template
 * name="mathjax", as of 2026-07). Fixed upstream since (the prefix is now
 * keyed on `$cdn-prefix`), so this matches nothing against the vendored
 * stylesheets; kept for an `xslDir` pointing at older ones.
 */
function fixMathJaxImport(html: string): string {
  return html.replace(
    /from '\.\/(https:\/\/[^']+)'/g,
    (_match, url: string) => `from '${url}'`,
  );
}

/**
 * Where PreTeXt's own static css/js live when a build takes its resources
 * from the CDN, as every preview does. Mirrors the
 * `$cdn-prefix` variable in pretext-html.xsl, which builds this same URL from
 * the `cli.version` parameter — hence the shared constant, so the fixup below
 * cannot point at a different release from the rest of the page.
 */
const HTML_STATIC_CDN = `https://cdn.jsdelivr.net/gh/PreTeXtBook/html-static@${HTML_STATIC_VERSION}/dist/`;

/**
 * String parameters every render starts from, before the caller's own.
 *
 * `cli.version` is pinned rather than left at upstream's "latest" because of
 * the Runestone parameters beside it: those name content-hashed bundle files
 * that exist only in the html-static release they were captured from, and the
 * three values are only consistent together. See scripts/refresh-runestone.mjs.
 *
 * The Runestone parameters are what make interactive exercises — multiple
 * choice, Parsons, fill-in-the-blank, ActiveCode — actually work. Without them
 * upstream emits the exercises' markup and no code to drive it, so they render
 * as inert boxes. This is orthogonal to `<platform runestone="yes">`, which
 * selects *server* hosting: the components are client-side either way, and an
 * ordinary web build links the same bundle.
 *
 * A caller can still override any of these through `RenderOptions.stringParams`
 * — passing an empty `rs-js`/`rs-css` restores the previous behaviour of
 * linking no Runestone code at all.
 */
const DEFAULT_STRING_PARAMS: Record<string, string> = {
  "cli.version": HTML_STATIC_VERSION,
  // Colon-delimited: pretext-runestone.xsl splits them with str:tokenize.
  "rs-js": RUNESTONE_JS.join(":"),
  "rs-css": RUNESTONE_CSS.join(":"),
  "rs-version": RUNESTONE_VERSION,
};

/**
 * Point the slideshow's `_static/` stylesheet at the CDN.
 *
 * Every other reveal.js resource honours the CDN build's `$cdn-prefix`,
 * but pretext-revealjs.xsl links `pretext-reveal.css` — the stylesheet that
 * does all of PreTeXt's slide styling — at a bare relative `_static/…` path
 * (as of 2026-07). In a real build that file has been copied next to the page;
 * for an in-memory render it 404s, and the deck renders with reveal's base
 * theme and none of PreTeXt's. Harmless once fixed upstream, since the URL
 * this produces is exactly what a prefixed href would emit.
 */
function fixRevealStaticCss(html: string): string {
  return html.replace(
    /(<link\b[^>]*\bhref=["'])_static\//gi,
    `$1${HTML_STATIC_CDN}_static/`,
  );
}

/**
 * Name of the first element in an XML string (the document root), or
 * undefined if none is found. Prolog constructs (declaration, processing
 * instructions, comments, doctype) are skipped textually.
 */
function documentRootName(xml: string): string | undefined {
  const prolog = xml
    .slice(0, 65536)
    .replace(/<\?[\s\S]*?\?>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!DOCTYPE[^>]*>/gi, " ");
  return prolog.match(/<\s*([A-Za-z][\w:-]*)/)?.[1];
}

/**
 * The one cache every render shares unless told otherwise. Keyed by file
 * path and validated by content, so sharing it across projects is safe; it
 * only ever costs memory, bounded by its entry limit.
 */
let sharedSourceCache: SourceCache | undefined;

/**
 * The parse cache renders use when {@link SourceOptions.cache} is not given.
 * Exposed so a host can drop it (`invalidate()`) or read its hit counts.
 */
export function defaultSourceCache(): SourceCache {
  return (sharedSourceCache ??= new SourceCache());
}

/**
 * Turn the caller's reader, file map and cache choice into what the include
 * resolver takes. The map is consulted first, then the reader, then (inside
 * `readWith`) the platform.
 */
function resolveOptionsFor(options: SourceOptions): ResolveOptions {
  const files = options.files
    ? new Map(
        Object.entries(options.files).map(([file, content]) => [
          path.resolve(file),
          content,
        ]),
      )
    : undefined;
  const custom = options.readSource;
  const readSource: SourceReader | undefined =
    files || custom
      ? async (file) => files?.get(file) ?? (await custom?.(file))
      : undefined;
  const cache =
    options.cache === false
      ? undefined
      : (options.cache ?? defaultSourceCache());
  return { readSource, cache };
}

/**
 * Read a file the caller named, failing loudly. Unlike the best-effort reads
 * (docinfo, mounted resources), there is no sensible way to continue without
 * the source or the publication file the caller explicitly asked for.
 */
async function readSourceOrThrow(
  resolve: ResolveOptions,
  location: string,
): Promise<string> {
  const content = await readWith(resolve, location);
  if (content === undefined) {
    throw new Error(
      `Could not read ${location}. ` +
        `(In the browser build only absolute URLs are readable — pass ` +
        `sourceContent instead of relying on sourcePath.)`,
    );
  }
  return content;
}

/**
 * Read and extract the `<docinfo>` from a project main file (resolving
 * xi:includes). Best-effort: returns undefined if the file cannot be read.
 */
async function docinfoFromSource(
  docinfoSourcePath: string,
  projectDir: string,
  resolve: ResolveOptions,
): Promise<string | undefined> {
  const resolved = path.resolve(docinfoSourcePath);
  const content = await readWith(resolve, resolved);
  if (content === undefined) {
    return undefined;
  }
  return extractDocinfo(content, resolved, projectDir, resolve);
}

/**
 * Measure a document without rendering it: resolve its xi:includes and count.
 * Cheap — with the parse cache warm, a copy of the tree and a walk — so a
 * host can decide before each render whether to preview the whole document
 * or one division of it (see {@link SubtreeOptions.wholeDocumentUpTo}), and
 * learn which files to watch.
 *
 * Measures the document at `sourcePath` as given: to size the book a
 * fragment belongs to, pass the main file.
 */
export async function measureDocument(
  options: SourceOptions,
): Promise<DocumentSize> {
  const resolve = resolveOptionsFor(options);
  const sourcePath = path.resolve(options.sourcePath);
  const projectDir = path.resolve(
    options.projectDir ?? path.dirname(sourcePath),
  );
  const sourceContent =
    options.sourceContent ?? (await readSourceOrThrow(resolve, sourcePath));
  const resolved = await resolveXIncludesToTree(
    sourceContent,
    sourcePath,
    projectDir,
    resolve,
  );
  return {
    bytes: resolved.bytes,
    elements: countElements(resolved.tree),
    files: resolved.files,
  };
}

/**
 * Wrap a fragment (xinclude-merged content whose root is not <pretext>) in a
 * minimal complete document so the stylesheets can process it. <chapter> and
 * <part> fragments become a one-chapter/one-part <book>; a fragment of a
 * slideshow becomes a <slideshow>; everything else becomes an <article>. The
 * fragment's own division heading renders normally; the wrapper itself is
 * untitled, so PreTeXt emits an empty top-level heading (the same "empty
 * article" preview approach used elsewhere). The explicit empty <title/> keeps
 * a title node present for stylesheets that dereference one without guarding.
 * A caller-supplied <docinfo> element (LaTeX macros, custom settings) is placed
 * inside <pretext> before the division so the fragment renders with the
 * project's real docinfo.
 *
 * The slideshow case is not cosmetic: pretext-revealjs.xsl's entry template
 * only ever descends into `<slideshow>`, so a slide wrapped in an <article>
 * renders as a blank page rather than as anything wrong-looking.
 */
function wrapFragment(
  mergedContent: string,
  rootName: string | undefined,
  target: RenderTarget,
  docinfo?: string,
): string {
  const body = mergedContent
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/, "")
    .replace(/<!DOCTYPE[^>]*>/i, "");
  const wrapper =
    target === "slides"
      ? "slideshow"
      : rootName === "chapter" || rootName === "part"
        ? "book"
        : "article";
  const docinfoBlock = docinfo?.trim() ? `${docinfo.trim()}\n` : "";
  return `<pretext>\n${docinfoBlock}<${wrapper}>\n<title/>\n${body}\n</${wrapper}>\n</pretext>\n`;
}

/**
 * Place `fragmentRoot` — the fragment's root element, as parsed from the
 * file at `fragmentPath` with its includes merged — where it belongs in the
 * document at `documentSourcePath`. The caller then prunes that document to
 * a skeleton around it (see skeleton.ts) and renders with upstream's
 * `subtree` parameter, which emits only the chosen division.
 *
 * Returns undefined — meaning "render it standalone instead" — whenever the
 * fragment cannot be located: no `@xml:id` on its root element, no division
 * with that id in the document, or a document that cannot be read or parsed.
 * All of these are ordinary states while writing (a brand new file, an id
 * being typed), not errors worth failing a preview over.
 */
async function placeFragmentInDocument(
  fragmentRoot: Element,
  fragmentPath: string,
  documentSourcePath: string,
  projectDir: string,
  documentSourceContent: string | undefined,
  resolve: ResolveOptions,
): Promise<
  { tree: Root; divisionId: string; files: string[]; bytes: number } | undefined
> {
  const divisionId = fragmentRoot.attributes["xml:id"];
  if (!divisionId) return undefined;

  const documentPath = path.resolve(documentSourcePath);
  const documentSource =
    documentSourceContent ?? (await readWith(resolve, documentPath));
  if (documentSource === undefined) return undefined;

  let tree: Root;
  let files: string[];
  let bytes: number;
  try {
    ({ tree, files, bytes } = await resolveXIncludesToTree(
      documentSource,
      documentPath,
      projectDir,
      resolve,
    ));
  } catch {
    // A malformed or unreachable include elsewhere in the book should not stop
    // the author previewing the file in front of them.
    return undefined;
  }
  // The editor's copy wins over the one on disk, so unsaved work is what gets
  // rendered; the document supplies only the structure around it. The copy
  // is tagged with its own file so the source map — and a cursor line used
  // to narrow the preview further — attribute its elements to that file.
  tagIncludedFile(fragmentRoot, fragmentPath);
  if (!replaceDivision(tree, divisionId, fragmentRoot)) return undefined;
  if (!files.includes(fragmentPath)) files.push(fragmentPath);
  return { tree, divisionId, files, bytes };
}

/**
 * Set once the WASM instance has aborted. Emscripten's `abort()` is terminal
 * — the module tears down its runtime and every later call fails somewhere
 * unhelpful (typically a pthread mutex assertion, having nothing to do with
 * whatever the caller was actually rendering). Remembering it lets us say so
 * plainly instead of surfacing that assertion once per render forever.
 */
let wasmAborted = false;

/** True for emscripten's terminal `abort()`, which no later call survives. */
function isTerminalWasmAbort(error: unknown): boolean {
  return error instanceof Error && /\bAborted\(/.test(error.message);
}

/** True for the engine's out-of-bounds trap, spelled differently per engine. */
function isWasmMemoryFault(error: unknown): boolean {
  return (
    error instanceof Error && /memory access|out of bounds/i.test(error.message)
  );
}

function assertWasmUsable(): void {
  if (wasmAborted) {
    throw new Error(
      "The WebAssembly renderer aborted earlier in this process and cannot " +
        "be reused. Restart the process (or reload the page) to render again.",
    );
  }
}

/**
 * Turn a WASM-level failure into something a caller can act on.
 *
 * Both causes below surface as the same out-of-bounds trap, and the engine
 * gives us nothing to tell them apart — so the message names both rather than
 * asserting the one that is merely more common. Reporting a size limit for
 * what is actually state corruption sends people off measuring their
 * documents, which is exactly the wrong place to look.
 *
 * 1. A genuine stack overflow. libxslt recurses per node and the published
 *    WASM build has a small (~64KB) stack, so very large documents (whole
 *    books) blow it. Needs a rebuild of libxslt-wasm with a bigger
 *    STACK_SIZE; see the README.
 * 2. Overlapping renders. Two transforms interleaving in the shared libxslt
 *    state corrupt it. {@link renderHtml} serializes to prevent this, so it
 *    should only be reachable by an embedder driving the internals directly.
 */
function throwIfWasmFailure(error: unknown): void {
  if (isTerminalWasmAbort(error)) {
    wasmAborted = true;
    throw new Error(
      "The WebAssembly renderer aborted and cannot be reused. Restart the " +
        "process (or reload the page) to render again.",
      { cause: error },
    );
  }
  if (isWasmMemoryFault(error)) {
    throw new Error(
      "The WebAssembly renderer hit a memory fault. Most often the document " +
        "is too large for this build's stack — whole-book builds are a known " +
        "limitation, so try a smaller document, or see the README about " +
        "rebuilding libxslt-wasm with a larger stack. The same fault also " +
        "results from running two renders concurrently against the shared " +
        "libxslt state.",
      { cause: error },
    );
  }
}

// libxslt-wasm is imported lazily so that merely importing this module (e.g.
// to call isJspiAvailable) works without the JSPI flag.
type LibXslt = typeof import("@pretextbook/libxslt-wasm");
let libxsltPromise: Promise<LibXslt> | undefined;
async function loadLibXslt(): Promise<LibXslt> {
  if (!libxsltPromise) {
    libxsltPromise = (async () => {
      const [lib, exslt] = await Promise.all([
        import("@pretextbook/libxslt-wasm"),
        import("@pretextbook/libxslt-wasm/exslt"),
      ]);
      exslt.registerAll();
      return lib;
    })();
  }
  return libxsltPromise;
}

type Stylesheet = Awaited<
  ReturnType<LibXslt["XsltStylesheet"]["fromXmlDocument"]>
>;
const stylesheetCache = new Map<string, Promise<Stylesheet>>();

/** The generated wrapper stylesheet each conversion enters through. */
const PREVIEW_STYLESHEETS: Record<RenderTarget, string> = {
  html: "preview-html.xsl",
  slides: "preview-revealjs.xsl",
};

/**
 * Compile (and cache) the preview stylesheet for `target` against the
 * stylesheets in `xslDir`. Compilation costs ~1s cold, so reuse across renders
 * matters — and a project that previews both a book and a deck compiles each
 * once rather than thrashing a single-entry cache.
 */
async function getStylesheet(
  xslDir: string,
  target: RenderTarget,
): Promise<Stylesheet> {
  const wrapper = PREVIEW_STYLESHEETS[target];
  // Keyed on the root as given: it may be a path or a URL, and only the
  // MountReader knows how to canonicalise it. Keyed on the wrapper too, since
  // the two compile to different stylesheets from the same directory.
  const key = `${target} ${xslDir}`;
  let cached = stylesheetCache.get(key);
  if (!cached) {
    cached = (async () => {
      const { XmlDocument, XsltStylesheet } = await loadLibXslt();
      const xslBase = mountDirectory(xslDir);
      // The wrappers sit one level above the stylesheets they import, so they
      // are read from the assets root but parsed as though they lived in the
      // xsl mount — that is what makes their relative <xsl:import> resolve.
      const previewXslBytes = await readMount(assetsBase(), `/${wrapper}`);
      if (previewXslBytes === undefined) {
        throw new Error(
          `Could not read ${wrapper} from ${assetsBase()}. ` +
            `Check the assets location (PRETEXT_HTML_ASSETS under Node, ` +
            `setAssetsBase() in the browser).`,
        );
      }
      const previewXsl = new TextDecoder().decode(previewXslBytes);
      const xslDoc = await XmlDocument.fromString(previewXsl, {
        url: `${xslBase}/${wrapper}`,
        options: { noEnt: true, dtdLoad: true, huge: true },
      });
      return XsltStylesheet.fromXmlDocument(xslDoc);
    })();
    stylesheetCache.set(key, cached);
    cached.catch(() => stylesheetCache.delete(key));
  }
  return cached;
}

/**
 * Serializes renders. **Correctness, not throughput.**
 *
 * A render is not reentrant. It drives a single cached compiled stylesheet
 * (see {@link getStylesheet}) through a patched `globalThis.fetch` and the
 * shared mount tables in mounts.ts — all module-level mutable state. The
 * transform also *suspends* mid-run to fetch stylesheets, which is the whole
 * point of JSPI, and that suspension is exactly the window in which a second
 * render gets to run. Overlapping renders interleave inside libxslt and
 * corrupt it.
 *
 * The failure is disproportionate to the mistake: the collision surfaces as
 * an out-of-bounds memory access, and the WASM instance then aborts on every
 * subsequent call for the lifetime of the process. Callers cannot reasonably
 * be expected to know this, and one that renders on a UI event (React's
 * StrictMode double invokes mount effects, for instance) hits it immediately.
 * So the queue lives here rather than in each caller's wrapper.
 */
let renderQueue: Promise<unknown> = Promise.resolve();

/**
 * Render a PreTeXt document to a single standalone HTML page.
 *
 * Every render pays PreTeXt's fixed assembly cost (~15 full-tree passes) plus
 * per-section rendering: roughly 100ms for a small article, a few seconds for
 * a 150-section book. Generated assets (latex-image, sageplot, …) are not
 * produced — those require the Python toolchain.
 *
 * Concurrent calls are safe but not parallel: they queue and run one at a
 * time (see {@link renderQueue}).
 */
export function renderHtml(options: RenderOptions): Promise<RenderResult> {
  // Chained off both outcomes so one failed render cannot wedge the queue.
  const result = renderQueue.then(
    () => renderHtmlSerial(options),
    () => renderHtmlSerial(options),
  );
  // Tracks completion only; the caller still receives the rejection.
  renderQueue = result.catch(() => undefined);
  return result;
}

async function renderHtmlSerial(options: RenderOptions): Promise<RenderResult> {
  assertJspi();
  assertWasmUsable();
  const { XmlDocument } = await loadLibXslt();

  const resolve = resolveOptionsFor(options);
  const sourcePath = path.resolve(options.sourcePath);
  const projectDir = path.resolve(
    options.projectDir ?? path.dirname(sourcePath),
  );
  const sourceContent =
    options.sourceContent ?? (await readSourceOrThrow(resolve, sourcePath));

  const relSource = path.relative(projectDir, sourcePath);
  if (relSource.startsWith("..")) {
    throw new Error(
      `sourcePath (${sourcePath}) must live inside projectDir (${projectDir})`,
    );
  }

  // The document is parsed under the *main* file's URL, because that is what
  // PreTeXt resolves publication-relative paths against (see
  // RenderOptions.mainSourcePath). For a complete document this is the source
  // file itself and nothing changes. A main file outside the mount cannot be
  // addressed at all, so fall back to the rendered file's own location.
  const relMain = path.relative(
    projectDir,
    path.resolve(options.mainSourcePath ?? sourcePath),
  );
  const relBase = relMain.startsWith("..") ? relSource : relMain;

  const srcBase = mountDirectory(projectDir);
  try {
    // The rewritten publication file is served as a virtual file. When the
    // user's publication file lives inside the project, keep its real URL so
    // any relative references inside it still resolve; virtual files shadow
    // the directory mount.
    let publicationSource: string | undefined;
    let publicationUrl = `${srcBase}/__pretext-preview-publication.xml`;
    if (options.publicationPath) {
      const pubPath = path.resolve(options.publicationPath);
      publicationSource = await readSourceOrThrow(resolve, pubPath);
      const relPub = path.relative(projectDir, pubPath);
      if (!relPub.startsWith("..")) {
        publicationUrl = `${srcBase}/${relPub.split(path.sep).join("/")}`;
      }
    }
    // xi:includes are resolved in JS before parsing: the WASM build cannot
    // suspend inside libxml2's own XInclude pass (see src/xinclude.ts). The
    // merged tree is kept too: its nodes carry the per-file line positions
    // the source map is built from and a cursor line is matched against,
    // and it is what the skeleton prunes.
    //
    // Done before the publication file is prepared, because which conversion
    // this is decides what goes into that file, and the answer can live in an
    // xi:included file (a slideshow whose slides are all included).
    const resolved = await resolveXIncludesToTree(
      sourceContent,
      sourcePath,
      projectDir,
      resolve,
    );
    let mergedTree: Root = resolved.tree;
    let mergedContent = resolved.content;
    let files = resolved.files;
    let bytes = resolved.bytes;

    const target = options.target ?? detectRenderTarget(mergedContent);
    const xslt = await getStylesheet(options.xslDir ?? defaultXslDir(), target);

    const publicationXml = forcePreviewPublication(publicationSource, {
      cssTheme: options.cssTheme,
      revealTheme: options.revealTheme,
      target,
    });
    setVirtualFile(publicationUrl, publicationXml);

    // The PreTeXt stylesheets silently produce a near-empty page (just a
    // doctype) for anything that is not a whole document. In fragment mode,
    // wrap fragments in a minimal complete document; otherwise reject them
    // with a real error.
    const rootElement = documentRootName(mergedContent);
    // Where the source map's id walk starts. For a complete document the
    // document element is a child of the (virtual) root: parent "root",
    // position 1 → "root-1". Fragment wrapping re-seats the walk (below).
    let mapRoot = { parentId: "root", position: 1 };
    // Set when one division is emitted out of a whole assembled document —
    // a fragment placed in its context document, or a `subtree` selection.
    let subtree: RenderResult["subtree"] | undefined;
    // The file a source-map walk should attribute the root element to. In
    // skeleton mode that is the document the skeleton was built from, not the
    // fragment; nodes spliced in from elsewhere carry their own file already.
    let mapRootFile = sourcePath;
    // The document as assembled, measured before any pruning.
    let size: DocumentSize | undefined;
    // The `@external` the built document's docinfo declares, which is where
    // PreTeXt now looks for the external directory first. Read from the
    // assembled tree, except for a wrapped fragment, whose docinfo is the one
    // it was given (below).
    let docinfoExternal: string | undefined;

    /**
     * Prune `tree` to a skeleton around the division to preview — the one
     * `options.subtree` selects, else `fallbackId` — unless the document is
     * small enough to show whole. Returns false when nothing was pruned.
     */
    const pruneToSubtree = (tree: Root, fallbackId?: string): boolean => {
      size = { bytes, elements: countElements(tree), files };
      const selection = options.subtree
        ? selectDivision(tree, options.subtree, sourcePath)
        : undefined;
      const divisionId = selection?.id ?? fallbackId;
      if (!divisionId) return false;
      const limit = options.subtree?.wholeDocumentUpTo;
      if (limit !== undefined && size.elements <= limit) return false;
      // The publication file decides how deep the contents list goes and
      // within what the blocks are numbered, and so how much of the document
      // the skeleton has to keep around the division.
      // The divisions a summary page will list, given ids before the
      // skeleton is serialized so that their links, the source map and this
      // result all name them the same way.
      const children =
        selection?.collapse && selection.element
          ? selection.element.children
              .filter(
                (child): child is Element =>
                  child.type === "element" && isStructural(child),
              )
              .map((child) => ensureXmlId(tree, child))
          : [];
      const skeleton = buildSkeleton(tree, divisionId, {
        collapseChildren: selection?.collapse,
        ...readPublicationLevels(publicationXml),
      });
      if (!skeleton) return false;
      mergedContent = skeleton.content;
      subtree = {
        id: skeleton.divisionId,
        level: skeleton.level,
        collapsed: skeleton.collapsed,
        children: skeleton.collapsed ? children : [],
      };
      return true;
    };

    if (rootElement !== "pretext" && rootElement !== "mathbook") {
      if (!options.fragment) {
        throw new Error(
          `The document root is <${rootElement ?? "?"}>, not <pretext> — ` +
            `this looks like an xi:included fragment. Render the project's ` +
            `main source file instead, or pass the fragment option.`,
        );
      }
      let placed = false;
      if (options.contextSourcePath || options.contextSourceContent) {
        // Preferred path: render the fragment where it really sits, so the
        // stylesheets number it — and resolve its cross-references — against
        // the whole document. Falls back to the standalone wrapper below when
        // the fragment cannot be located in that document.
        //
        // With no real contextSourcePath, the context document still needs a
        // virtual identity to resolve its own xi:includes against — but it
        // must not be sourcePath itself: the context document legitimately
        // xi:includes the previewed fragment, and reusing the fragment's own
        // path here would make that include look like a self-cycle back to
        // the file already on the resolution stack, silently dropping it.
        const contextPath =
          options.contextSourcePath ??
          path.join(path.dirname(sourcePath), "__pretext-preview-context.ptx");
        const fragmentRoot = mergedTree.children.find(
          (node): node is Element => node.type === "element",
        );
        const placement = fragmentRoot
          ? await placeFragmentInDocument(
              fragmentRoot,
              sourcePath,
              contextPath,
              projectDir,
              options.contextSourceContent,
              resolve,
            )
          : undefined;
        if (placement) {
          placed = true;
          mergedTree = placement.tree;
          docinfoExternal = docinfoExternalDirectory(mergedTree);
          files = placement.files;
          bytes = placement.bytes;
          // The placed document is a complete <pretext> document, so the id
          // walk starts where it does for any whole document — mapRoot
          // stands.
          mapRootFile = path.resolve(contextPath);
          if (!pruneToSubtree(mergedTree, placement.divisionId)) {
            // Small enough to show whole: the fragment in its entire
            // document. (The skeleton serializes itself otherwise.)
            mergedContent = toXml(mergedTree);
          }
        }
      }
      if (!placed) {
        // Prefer an explicit docinfo string; otherwise lift one (resolving
        // xi:includes) from the project's main file so the fragment keeps its
        // macros. Reads only the docinfo, so the chapters are not merged.
        // Best-effort: a missing/unreadable main file just means no macros.
        const docinfo =
          options.docinfo ??
          (options.docinfoSourcePath
            ? await docinfoFromSource(
                options.docinfoSourcePath,
                projectDir,
                resolve,
              )
            : undefined);
        mergedContent = wrapFragment(
          mergedContent,
          rootElement,
          target,
          docinfo,
        );
        docinfoExternal =
          docinfo === undefined ? undefined : docinfoExternalDirectory(docinfo);
        // Mirror the wrapper's ids: <pretext> is root-1; the division element
        // is its first element child — second when a docinfo precedes it —
        // and the fragment root sits after the wrapper's empty <title/>.
        const wrapperId = docinfo?.trim() ? "root-1-2" : "root-1-1";
        mapRoot = { parentId: wrapperId, position: 2 };
      }
    } else {
      docinfoExternal = docinfoExternalDirectory(mergedTree);
      if (options.subtree) {
        // A complete document, of which one division is wanted.
        pruneToSubtree(mergedTree);
      }
    }
    size ??= { bytes, elements: countElements(mergedTree), files };

    // Map PreTeXt's fixed `external/` and `generated/` URL prefixes back to
    // real directories, so a host can serve what the page asks for. Anchored
    // at the main file's directory, matching the document URL below.
    const declaredDirs = readAssetDirectories(publicationXml, docinfoExternal);
    const mainDir = path.dirname(path.resolve(projectDir, relBase));
    const assetDirs: RenderResult["assetDirs"] = {
      generated: path.resolve(mainDir, declaredDirs.generated),
      ...(declaredDirs.external !== undefined
        ? { external: path.resolve(mainDir, declaredDirs.external) }
        : {}),
    };

    const sourceMap = options.sourceMap
      ? computeSourceMap(mergedTree, mapRootFile, mapRoot)
      : undefined;

    const doc = await XmlDocument.fromString(mergedContent, {
      url: `${srcBase}/${relBase.split(path.sep).join("/")}`,
      options: { noEnt: true, dtdLoad: true, huge: true },
    });

    const params: Record<string, string> = {
      publisher: xpathStringLiteral(publicationUrl),
    };
    for (const [name, value] of Object.entries(DEFAULT_STRING_PARAMS)) {
      params[name] = xpathStringLiteral(value);
    }
    if (subtree) {
      // Emit only the previewed division, out of the whole assembled document.
      // "subtree-level" raises the chunk level to that division's own, which
      // the preview publication otherwise pins to 0 — see SUBTREE_CHUNK_LEVEL_OVERRIDE
      // in scripts/refresh-xsl.mjs. One level past it makes the division a
      // summary page: its own content and links to the divisions inside it
      // (see SUMMARY_PAGE_OVERRIDE there), which is what a collapsed skeleton
      // has left of them anyway.
      params["subtree"] = xpathStringLiteral(subtree.id);
      params["subtree-level"] = xpathStringLiteral(
        String(subtree.level + (subtree.collapsed ? 1 : 0)),
      );
    }
    // Last, so a caller can override any default above.
    for (const [name, value] of Object.entries(options.stringParams ?? {})) {
      params[name] = xpathStringLiteral(value);
    }

    let result;
    try {
      result = await xslt.apply(doc, params);
    } catch (error) {
      throwIfWasmFailure(error);
      // libxslt already printed the real diagnostics (PTX:ERROR/PTX:FATAL,
      // xsl:message output) on stderr; the thrown error itself is generic.
      throw new Error(
        "PreTeXt XSLT transform failed; see the PTX:ERROR/PTX:FATAL " +
          "messages on stderr for details.",
        { cause: error },
      );
    } finally {
      doc.delete();
    }
    try {
      let html = fixMathJaxImport(result.toHtmlString());
      // Point links at what this one page can actually reach, and make the
      // ones reaching past it inert rather than silently dead. A no-op for a
      // whole-document preview, which links only within the page.
      html = rewriteXrefLinks(html, {
        ...(options.offPageMessage !== undefined
          ? { offPageMessage: options.offPageMessage }
          : {}),
      });
      // Before the target-specific bridges, so both a document and a deck get
      // their knowls opened.
      if (options.openKnowls ?? true) {
        html = openBornHiddenKnowls(html);
      }
      if (target === "slides") {
        html = fixRevealStaticCss(html);
        html = injectRevealBridge(html, options.revealView ?? "scroll", {
          zoom: options.revealZoom,
        });
        // RenderOptions.theme is deliberately not applied: a deck loads no
        // pretext-core.js, so there is no setDarkMode for the bridge to call
        // and injecting it would only add dead script. revealTheme is the
        // slideshow equivalent, and it goes in through the publication file.
      } else if (options.theme) {
        html = injectThemeBridge(html, options.theme);
      }
      // Applies to both targets: a slideshow preview is exactly as unbuilt as
      // a document one.
      if (options.previewBanner) {
        html = injectPreviewBanner(html, options.previewBanner);
      }
      // A deck has no printouts and none of the print controls that drive the
      // layout, so this is a document-only affair.
      const printouts = target === "slides" ? [] : listPrintouts(html);
      // The root element as authored, before any fragment wrapping: that is
      // what says whether this document *is* a printout. See rootPrintoutId.
      const rootPrintout = rootPrintoutId(printouts, rootElement);
      if (options.printPreview) {
        html = injectPrintPreview(html, options.printPreview);
      }
      return {
        html,
        target,
        printouts,
        size,
        assetDirs,
        ...(subtree ? { subtree } : {}),
        ...(sourceMap ? { sourceMap } : {}),
        ...(rootPrintout ? { rootPrintout } : {}),
      };
    } catch (error) {
      throwIfWasmFailure(error);
      throw error;
    } finally {
      result.delete();
    }
  } finally {
    unmountDirectory(srcBase);
  }
}
