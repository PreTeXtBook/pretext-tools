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

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { mountDirectory, setVirtualFile, unmountDirectory } from "./mounts.js";
import { forcePortablePublication } from "./publication.js";
import { computeSourceMap, type PtxSourceMap } from "./sourcemap.js";
import { injectThemeBridge, type PreviewTheme } from "./theme.js";
import {
  extractDocinfo,
  resolveXIncludes,
  resolveXIncludesToTree,
} from "./xinclude.js";

export interface RenderOptions {
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
   * Path to a publication file. Its settings are respected except
   * `<html><platform portable="yes"/></html>`, which the preview forces.
   */
  publicationPath?: string;
  /** Additional XSLT string parameters, passed as strings (quoted for you). */
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
   * Also compute a source map: one entry per element, in document order,
   * mapping the element's @unique-id (its HTML id, when the page emits one)
   * to the file/line it was authored in — through xi:includes. Powers
   * editor/preview sync; the rendered page itself is unchanged. See
   * sourcemap.ts for the id contract with pretext-assembly.xsl.
   */
  sourceMap?: boolean;
  /**
   * Let the embedding app control the preview's light/dark theme. When set, a
   * small bridge script is injected into the page that applies this value as
   * the initial theme and then follows `postMessage`s from the embedder (see
   * `previewThemeMessage` / theme.ts). Omit to leave the page's native
   * behaviour (localStorage + `prefers-color-scheme`) untouched — the output
   * is then byte-identical to a render without this option.
   */
  theme?: PreviewTheme;
}

export interface RenderResult {
  /** Complete standalone HTML page (CDN-hosted css/js/MathJax). */
  html: string;
  /** Present when RenderOptions.sourceMap was set. */
  sourceMap?: PtxSourceMap;
}

// Computed with path functions rather than `new URL(..., import.meta.url)`
// so vite's asset handling does not inline the file at build time. Works from
// both src/ and dist/, which sit at the same depth in the package. The env
// var override serves bundlers (the VS Code extension bundles this module and
// ships the assets elsewhere).
function assetsDir(): string {
  return (
    process.env["PRETEXT_HTML_ASSETS"] ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets")
  );
}

/** Vendored stylesheets shipped with this package. */
export function defaultXslDir(): string {
  return path.join(assetsDir(), "xsl");
}

function defaultPreviewXslPath(): string {
  return path.join(assetsDir(), "preview-html.xsl");
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
 * is an absolute CDN URL under portable builds (pretext-html.xsl, template
 * name="mathjax", as of 2026-07). Harmless once fixed upstream.
 */
function fixMathJaxImport(html: string): string {
  return html.replace(
    /from '\.\/(https:\/\/[^']+)'/g,
    (_match, url: string) => `from '${url}'`,
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
 * Read and extract the `<docinfo>` from a project main file (resolving
 * xi:includes). Best-effort: returns undefined if the file cannot be read.
 */
async function docinfoFromSource(
  docinfoSourcePath: string,
  projectDir: string,
): Promise<string | undefined> {
  const resolved = path.resolve(docinfoSourcePath);
  let content: string;
  try {
    content = await readFile(resolved, "utf8");
  } catch {
    return undefined;
  }
  return extractDocinfo(content, resolved, projectDir);
}

/**
 * Wrap a fragment (xinclude-merged content whose root is not <pretext>) in a
 * minimal complete document so the stylesheets can process it. <chapter> and
 * <part> fragments become a one-chapter/one-part <book>; everything else
 * becomes an <article>. The fragment's own division heading renders normally;
 * the wrapper itself is untitled, so PreTeXt emits an empty top-level heading
 * (the same "empty article" preview approach used elsewhere). The explicit
 * empty <title/> keeps a title node present for stylesheets that dereference
 * one without guarding. A caller-supplied <docinfo> element (LaTeX macros,
 * custom settings) is placed inside <pretext> before the division so the
 * fragment renders with the project's real docinfo.
 */
function wrapFragment(
  mergedContent: string,
  rootName: string | undefined,
  docinfo?: string,
): string {
  const body = mergedContent
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/, "")
    .replace(/<!DOCTYPE[^>]*>/i, "");
  const wrapper =
    rootName === "chapter" || rootName === "part" ? "book" : "article";
  const docinfoBlock = docinfo?.trim() ? `${docinfo.trim()}\n` : "";
  return `<pretext>\n${docinfoBlock}<${wrapper}>\n<title/>\n${body}\n</${wrapper}>\n</pretext>\n`;
}

/**
 * Map the WASM engine's out-of-bounds errors ("memory access out of bounds",
 * "out of bounds memory access", depending on engine/version) to an
 * actionable message. libxslt recurses per node and the published WASM build
 * has a small (~64KB) stack, so very large documents (whole books) blow it.
 * Needs a rebuild of libxslt-wasm with a bigger STACK_SIZE; see the README.
 */
function throwIfWasmStackOverflow(error: unknown): void {
  if (
    error instanceof Error &&
    /memory access|out of bounds/i.test(error.message)
  ) {
    throw new Error(
      "The document is too large for the current WebAssembly build " +
        "(stack overflow). Whole-book builds are a known limitation; " +
        "try a smaller document, or see the README about rebuilding " +
        "libxslt-wasm with a larger stack.",
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

/**
 * Compile (and cache) the preview stylesheet against the stylesheets in
 * `xslDir`. Compilation costs ~1s cold, so reuse across renders matters.
 */
async function getStylesheet(xslDir: string): Promise<Stylesheet> {
  const key = path.resolve(xslDir);
  let cached = stylesheetCache.get(key);
  if (!cached) {
    cached = (async () => {
      const { XmlDocument, XsltStylesheet } = await loadLibXslt();
      const xslBase = mountDirectory(key);
      const previewXsl = await readFile(defaultPreviewXslPath(), "utf8");
      const xslDoc = await XmlDocument.fromString(previewXsl, {
        url: `${xslBase}/preview-html.xsl`,
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
 * Render a PreTeXt document to a single standalone HTML page.
 *
 * Every render pays PreTeXt's fixed assembly cost (~15 full-tree passes) plus
 * per-section rendering: roughly 100ms for a small article, a few seconds for
 * a 150-section book. Generated assets (latex-image, sageplot, …) are not
 * produced — those require the Python toolchain.
 */
export async function renderHtml(
  options: RenderOptions,
): Promise<RenderResult> {
  assertJspi();
  const { XmlDocument } = await loadLibXslt();
  const xslt = await getStylesheet(options.xslDir ?? defaultXslDir());

  const sourcePath = path.resolve(options.sourcePath);
  const projectDir = path.resolve(
    options.projectDir ?? path.dirname(sourcePath),
  );
  const sourceContent =
    options.sourceContent ?? (await readFile(sourcePath, "utf8"));

  const relSource = path.relative(projectDir, sourcePath);
  if (relSource.startsWith("..")) {
    throw new Error(
      `sourcePath (${sourcePath}) must live inside projectDir (${projectDir})`,
    );
  }

  const srcBase = mountDirectory(projectDir);
  try {
    // The rewritten publication file is served as a virtual file. When the
    // user's publication file lives inside the project, keep its real URL so
    // any relative references inside it still resolve; virtual files shadow
    // the directory mount.
    let publicationXml: string;
    let publicationUrl = `${srcBase}/__pretext-preview-publication.xml`;
    if (options.publicationPath) {
      const pubPath = path.resolve(options.publicationPath);
      publicationXml = forcePortablePublication(
        await readFile(pubPath, "utf8"),
      );
      const relPub = path.relative(projectDir, pubPath);
      if (!relPub.startsWith("..")) {
        publicationUrl = `${srcBase}/${relPub.split(path.sep).join("/")}`;
      }
    } else {
      publicationXml = forcePortablePublication();
    }
    setVirtualFile(publicationUrl, publicationXml);

    // xi:includes are resolved in JS before parsing: the WASM build cannot
    // suspend inside libxml2's own XInclude pass (see src/xinclude.ts). When
    // a source map is wanted, keep the merged tree too — its nodes carry the
    // per-file line positions the map is built from.
    let mergedTree;
    let mergedContent: string;
    if (options.sourceMap) {
      const resolved = await resolveXIncludesToTree(
        sourceContent,
        sourcePath,
        projectDir,
      );
      mergedTree = resolved.tree;
      mergedContent = resolved.content;
    } else {
      mergedContent = await resolveXIncludes(
        sourceContent,
        sourcePath,
        projectDir,
      );
    }

    // The PreTeXt stylesheets silently produce a near-empty page (just a
    // doctype) for anything that is not a whole document. In fragment mode,
    // wrap fragments in a minimal complete document; otherwise reject them
    // with a real error.
    const rootElement = documentRootName(mergedContent);
    // Where the source map's id walk starts. For a complete document the
    // document element is a child of the (virtual) root: parent "root",
    // position 1 → "root-1". Fragment wrapping re-seats the walk (below).
    let mapRoot = { parentId: "root", position: 1 };
    if (rootElement !== "pretext" && rootElement !== "mathbook") {
      if (options.fragment) {
        // Prefer an explicit docinfo string; otherwise lift one (resolving
        // xi:includes) from the project's main file so the fragment keeps its
        // macros. Reads only the docinfo, so the chapters are not merged.
        // Best-effort: a missing/unreadable main file just means no macros.
        const docinfo =
          options.docinfo ??
          (options.docinfoSourcePath
            ? await docinfoFromSource(options.docinfoSourcePath, projectDir)
            : undefined);
        mergedContent = wrapFragment(mergedContent, rootElement, docinfo);
        // Mirror the wrapper's ids: <pretext> is root-1; the <article>/<book>
        // is its first element child — second when a docinfo precedes it —
        // and the fragment root sits after the wrapper's empty <title/>.
        const wrapperId = docinfo?.trim() ? "root-1-2" : "root-1-1";
        mapRoot = { parentId: wrapperId, position: 2 };
      } else {
        throw new Error(
          `The document root is <${rootElement ?? "?"}>, not <pretext> — ` +
            `this looks like an xi:included fragment. Render the project's ` +
            `main source file instead, or pass the fragment option.`,
        );
      }
    }

    const sourceMap = mergedTree
      ? computeSourceMap(mergedTree, sourcePath, mapRoot)
      : undefined;

    const doc = await XmlDocument.fromString(mergedContent, {
      url: `${srcBase}/${relSource.split(path.sep).join("/")}`,
      options: { noEnt: true, dtdLoad: true, huge: true },
    });

    const params: Record<string, string> = {
      publisher: xpathStringLiteral(publicationUrl),
    };
    for (const [name, value] of Object.entries(options.stringParams ?? {})) {
      params[name] = xpathStringLiteral(value);
    }

    let result;
    try {
      result = await xslt.apply(doc, params);
    } catch (error) {
      throwIfWasmStackOverflow(error);
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
      if (options.theme) {
        html = injectThemeBridge(html, options.theme);
      }
      return {
        html,
        ...(sourceMap ? { sourceMap } : {}),
      };
    } catch (error) {
      throwIfWasmStackOverflow(error);
      throw error;
    } finally {
      result.delete();
    }
  } finally {
    unmountDirectory(srcBase);
  }
}
