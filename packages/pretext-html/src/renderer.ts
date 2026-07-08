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
import { resolveXIncludes } from "./xinclude.js";

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
}

export interface RenderResult {
  /** Complete standalone HTML page (CDN-hosted css/js/MathJax). */
  html: string;
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

// libxslt-wasm is imported lazily so that merely importing this module (e.g.
// to call isJspiAvailable) works without the JSPI flag.
type LibXslt = typeof import("libxslt-wasm");
let libxsltPromise: Promise<LibXslt> | undefined;
async function loadLibXslt(): Promise<LibXslt> {
  if (!libxsltPromise) {
    libxsltPromise = (async () => {
      const [lib, exslt] = await Promise.all([
        import("libxslt-wasm"),
        import("libxslt-wasm/exslt"),
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
    // suspend inside libxml2's own XInclude pass (see src/xinclude.ts).
    const mergedContent = await resolveXIncludes(
      sourceContent,
      sourcePath,
      projectDir,
    );

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
      if (
        error instanceof Error &&
        error.message.includes("memory access out of bounds")
      ) {
        // libxslt recurses per node and the published WASM build has a small
        // (~64KB) stack, so very large documents (whole books) blow it. Needs
        // a rebuild of libxslt-wasm with a bigger STACK_SIZE; see the README.
        throw new Error(
          "The document is too large for the current WebAssembly build " +
            "(stack overflow). Whole-book builds are a known limitation; " +
            "try a smaller document, or see the README about rebuilding " +
            "libxslt-wasm with a larger stack.",
          { cause: error },
        );
      }
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
      return { html: fixMathJaxImport(result.toHtmlString()) };
    } finally {
      result.delete();
    }
  } finally {
    unmountDirectory(srcBase);
  }
}
