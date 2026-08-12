// Refresh the vendored PreTeXt XSL stylesheets from upstream and regenerate
// the preview wrapper stylesheet.
//
// Usage:
//   node scripts/refresh-xsl.mjs                 # fetch PreTeXtBook/pretext master
//   node scripts/refresh-xsl.mjs --ref <ref>     # fetch a specific branch/tag/commit
//   node scripts/refresh-xsl.mjs --local <dir>   # copy from a local pretext checkout
//   node scripts/refresh-xsl.mjs --generate-only # regenerate wrappers, no fetch
//
// Also re-captures the Runestone Services bundle from the html-static CDN
// (see scripts/refresh-runestone.mjs), except under --generate-only.
//
// Two wrapper stylesheets are generated, not hand-maintained:
//
//   assets/preview-html.xsl     - ordinary documents. Contains a verbatim copy
//     of the upstream "file-wrap" template with the <exsl:document> wrapper
//     removed, so the whole document is emitted as a single complete HTML page
//     on the main result tree.
//   assets/preview-revealjs.xsl - slideshows. Needs no such copy: the reveal.js
//     conversion overrides the entry template and emits one monolithic page
//     already. It only stubs the file writers and stamps ids onto slides.
//
// Regenerating them here keeps them in lockstep with the vendored stylesheets.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { refreshRunestoneServices } from "./refresh-runestone.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const assetsDir = path.join(packageRoot, "assets");
const xslDir = path.join(assetsDir, "xsl");

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const localDir = getArg("--local");
const ref = getArg("--ref") ?? "master";
const generateOnly = process.argv.includes("--generate-only");

/**
 * Stubs for every file-writing template reachable from pretext-html.xsl, which
 * both wrappers need: any <exsl:document> that does fire aborts the
 * FILESYSTEM=0 WASM build, and emscripten's abort() is terminal — the renderer
 * is unusable for the rest of the process, not just for that one render.
 *
 * Under portable-html several of these are already suppressed by publication
 * settings, but not all: an <interactive> on a slide reaches
 * "create-iframe-page" and writes a page even in a portable build. Kept as one
 * shared constant so the two wrappers cannot drift apart, and so this list
 * stays next to the KNOWN_WRITER_TEMPLATES audit that guards it.
 *
 * "file-wrap" is deliberately absent: preview-html.xsl replaces it with the
 * inlined copy, and the reveal.js conversion never chunks, so it is unreachable
 * there.
 */
const FILE_WRITER_STUBS = `<xsl:template name="index-redirect-page"/>
<xsl:template match="*" mode="manufacture-knowl"/>
<xsl:template name="ol-marker-styles"/>
<xsl:template name="doc-manifest"/>
<xsl:template name="search-page-construction"/>
<xsl:template name="scorm-manifest"/>
<!-- standalone pages for videos and iframe pages for interactives -->
<xsl:template match="*" mode="standalone-page"/>
<xsl:template match="*" mode="create-iframe-page"/>
<!-- runestone-manifest lives in pretext-runestone.xsl -->
<xsl:template match="*" mode="runestone-manifest"/>
<xsl:template match="*" mode="simple-file-wrap">
    <xsl:param name="content"/>
    <xsl:copy-of select="$content"/>
</xsl:template>`;

/**
 * Neutralize the print-preview buttons upstream puts on printout headings
 * (worksheet, handout, and whatever &PRINTOUT; grows to include later).
 *
 * Upstream's button is a link to `?printpreview=<id>`, which reloads the page
 * with a query parameter that pretext-core.js picks up on DOMContentLoaded and
 * uses to reformat the printout for printing. A preview has no page to reload:
 * it is rendered in memory and handed to a host, so the navigation at best does
 * nothing and at worst — when the host resolves that query against its own URL,
 * as pretext.plus does — takes the reader somewhere unrelated to the document.
 *
 * The button is still drawn, because its absence would misrepresent the built
 * page, but it is grayed out and carries no @href. Dropping @href is all it
 * takes to make it inert: nothing binds a click handler to `.print-link`, the
 * URL parameter is the entire mechanism. The theme's styling is class-based
 * (`.heading .print-links .print-link`), so layout is unaffected.
 *
 * Matched on `*` rather than the printout element names: the generated wrapper
 * has no DTD, so the &PRINTOUT; entity the upstream template matches on is not
 * available here. Import precedence makes this template win over the imported
 * one regardless of its lower priority, and matching `*` means printouts added
 * upstream later are covered without a refresh of this script.
 */
const PRINTOUT_LINK_OVERRIDE = `<xsl:template match="*" mode="standalone-printout-links">
    <div class="print-links">
        <a class="print-link" style="opacity:0.45;cursor:default" aria-disabled="true" title="Print preview is not available in the live preview">
            <xsl:call-template name="insert-symbol">
                <xsl:with-param name="name" select="'print'"/>
            </xsl:call-template>
        </a>
    </div>
</xsl:template>`;

/**
 * Let `$subtree` name a division at any depth.
 *
 * Upstream's `$subtree` parameter (pretext-html.xsl) assembles the whole
 * document — so numbering and every `id()` lookup see the complete source —
 * but emits only the division carrying that @xml:id. That is exactly what a
 * fragment preview wants: the section on screen numbered as it will be in the
 * built book, with cross-references to the rest of the document resolved.
 *
 * It refuses to run here unmodified. Portable builds pin `html-chunk-level` to
 * 0 (publisher-variables.xsl), and upstream aborts with a FATAL when the
 * subtree root sits below the chunk level — "only a partial HTML page at the
 * current chunking level". Every division except the document root is below
 * level 0, so every fragment preview would abort.
 *
 * Raising the chunk level to the subtree root's own level clears that check
 * and still yields exactly one page: only `$subtree-node` is walked, and
 * everything inside it is below the chunk level and so stays on the page.
 * Chunk level is left alone when `$subtree` is empty, so whole-document
 * previews are byte-identical to before.
 *
 * `$chunk-level` is a variable, not a parameter, so it cannot be set from the
 * outside — hence the separate `$subtree-level` parameter and the override
 * here. Import precedence makes this definition win over the imported one.
 */
const SUBTREE_CHUNK_LEVEL_OVERRIDE = `<xsl:param name="subtree-level" select="''"/>
<xsl:variable name="chunk-level">
    <xsl:choose>
        <xsl:when test="$subtree != '' and $subtree-level != ''">
            <xsl:value-of select="number($subtree-level)"/>
        </xsl:when>
        <xsl:otherwise>
            <xsl:value-of select="$html-chunk-level"/>
        </xsl:otherwise>
    </xsl:choose>
</xsl:variable>`;

/**
 * Extract the entries of a zip archive that `wanted` accepts.
 *
 * The archive is read in process rather than by shelling out to an unzip tool,
 * because there is no such tool that exists on every platform — Windows has no
 * `unzip`, and `Expand-Archive` is PowerShell-only. Node cannot read a zip
 * container on its own either (`node:zlib` is raw deflate/gzip, not the zip
 * central directory), hence jszip.
 *
 * Only the ~96 wanted entries are written out. The archive holds ~2000 files,
 * some nested deeply enough that unpacking all of them under a temp directory
 * would exceed Windows' MAX_PATH.
 *
 * `strip` drops leading path components, like tar's `--strip-components`; the
 * GitHub archive puts everything under a single `pretext-<ref>/` directory.
 */
async function extractZip(archive, destDir, { strip = 0, wanted }) {
  const zip = await JSZip.loadAsync(archive);
  let count = 0;

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      continue;
    }
    const relPath = name.split("/").slice(strip).join("/");
    if (relPath === "" || !wanted(relPath)) {
      continue;
    }
    // The archive is trusted, but a traversing member would write outside the
    // temp directory, so refuse rather than assume.
    const target = path.resolve(destDir, relPath);
    if (target !== destDir && !target.startsWith(destDir + path.sep)) {
      throw new Error(`Refusing to extract outside the target: ${name}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await entry.async("nodebuffer"));
    count += 1;
  }

  if (count === 0) {
    throw new Error(
      "Extracted no files from the pretext archive. Its layout has changed; " +
        "refresh-xsl.mjs needs updating.",
    );
  }
  return count;
}

async function fetchUpstreamXsl() {
  const url = `https://codeload.github.com/PreTeXtBook/pretext/zip/refs/heads/${ref}`;
  console.log(`Downloading ${url} ...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download pretext archive (${response.status})`);
  }
  const archive = Buffer.from(await response.arrayBuffer());

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-xsl-"));
  // The stylesheets, plus whichever license file copyXslTree goes looking for.
  const count = await extractZip(archive, tmpDir, {
    strip: 1,
    wanted: (relPath) =>
      relPath.startsWith("xsl/") ||
      relPath === "COPYING" ||
      relPath.startsWith("LICENSE"),
  });
  console.log(`Extracted ${count} files`);
  return tmpDir;
}

function copyXslTree(sourceRoot) {
  const sourceXsl = path.join(sourceRoot, "xsl");
  if (!fs.existsSync(path.join(sourceXsl, "pretext-html.xsl"))) {
    throw new Error(`No pretext-html.xsl found under ${sourceXsl}`);
  }
  fs.rmSync(xslDir, { recursive: true, force: true });
  fs.cpSync(sourceXsl, xslDir, { recursive: true });
  // Ship the upstream license alongside the vendored (GPL-licensed) files.
  // PreTeXt names it COPYING; the LICENSE* spellings are here in case that
  // changes. Not optional: the vendored stylesheets are GPL, so failing to
  // find it is an error rather than something to skip quietly.
  const licenseName = ["COPYING", "LICENSE", "LICENSE.txt", "LICENSE.md"].find(
    (name) => fs.existsSync(path.join(sourceRoot, name)),
  );
  if (!licenseName) {
    throw new Error(
      `No license file found at ${sourceRoot}. The vendored stylesheets are ` +
        `GPL-licensed and must ship with upstream's license text.`,
    );
  }
  fs.copyFileSync(
    path.join(sourceRoot, licenseName),
    path.join(xslDir, "LICENSE-pretext"),
  );
  console.log(`Copied XSL tree to ${xslDir} (license: ${licenseName})`);
}

/**
 * Generate assets/preview-html.xsl.
 *
 * Extracts the body of the `file-wrap` template from the vendored
 * pretext-html.xsl and strips the <exsl:document> element (keeping its
 * children) so the page lands on the main result tree instead of aborting in
 * the FILESYSTEM=0 WASM build. All other file-writing templates are stubbed;
 * most are already suppressed by the portable-html publication setting the
 * renderer forces. Printout headings additionally get their print-preview
 * buttons disabled (see PRINTOUT_LINK_OVERRIDE).
 */
function generatePreviewXsl() {
  const htmlXsl = fs.readFileSync(
    path.join(xslDir, "pretext-html.xsl"),
    "utf8",
  );

  const startMarker = '<xsl:template match="*" mode="file-wrap">';
  const start = htmlXsl.indexOf(startMarker);
  if (start === -1) {
    throw new Error(
      'Could not find `<xsl:template match="*" mode="file-wrap">` in pretext-html.xsl. ' +
        "Upstream has changed; preview-html.xsl generation needs updating.",
    );
  }
  const end = htmlXsl.indexOf("</xsl:template>", start);
  const template = htmlXsl.slice(start, end + "</xsl:template>".length);

  const opens = template.match(/<exsl:document\b[^>]*>/g) ?? [];
  const closes = template.match(/<\/exsl:document>/g) ?? [];
  if (opens.length !== 1 || closes.length !== 1) {
    throw new Error(
      `Expected exactly one exsl:document element in file-wrap (found ${opens.length} open / ${closes.length} close). ` +
        "Upstream has changed; preview-html.xsl generation needs updating.",
    );
  }
  const inlineTemplate = template
    .replace(opens[0], "")
    .replace("</exsl:document>", "");

  const wrapper = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  GENERATED FILE - do not edit by hand.
  Regenerate with: npm run refresh-xsl -w @pretextbook/pretext-html

  Wrapper around pretext-html.xsl for single-page in-memory HTML builds
  (previews). The "file-wrap" template below is a verbatim copy of the
  upstream template with the <exsl:document> element removed, so the complete
  page is emitted on the main result tree. Intended to be applied together
  with a publication file that sets <html><platform portable="yes"/></html>,
  which forces chunk level 0 (one page) and CDN-hosted css/js, and suppresses
  most auxiliary file output. Remaining file writers are stubbed at the end.
-->
<xsl:stylesheet
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
    xmlns:xml="http://www.w3.org/XML/1998/namespace"
    xmlns:svg="http://www.w3.org/2000/svg"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:pi="http://pretextbook.org/2020/pretext/internal"
    xmlns:exsl="http://exslt.org/common"
    xmlns:date="http://exslt.org/dates-and-times"
    xmlns:str="http://exslt.org/strings"
    xmlns:fn="http://www.w3.org/2005/xpath-functions"
    xmlns:pf="https://prefigure.org"
    exclude-result-prefixes="svg xlink pi fn pf"
    extension-element-prefixes="exsl date str"
>

<xsl:import href="pretext-html.xsl"/>
<xsl:output method="html" encoding="UTF-8" doctype-system="about:legacy-compat"/>

<!-- Copied from pretext-html.xsl (mode="file-wrap"), exsl:document removed -->
${inlineTemplate}

<!-- Chunk at the subtree root's own level, so a fragment preview can name a  -->
<!-- division of any depth as $subtree. Without this, portable's chunk level  -->
<!-- of 0 makes upstream abort on every division below the document root.     -->
<!-- See SUBTREE_CHUNK_LEVEL_OVERRIDE in refresh-xsl.mjs.                     -->
${SUBTREE_CHUNK_LEVEL_OVERRIDE}

<!-- Show the print-preview button on printouts, but inert: the page it would -->
<!-- reload with "?printpreview=<id>" does not exist for an in-memory render, -->
<!-- and a host that resolves that query against its own URL sends the reader -->
<!-- somewhere unrelated. See PRINTOUT_LINK_OVERRIDE in refresh-xsl.mjs.      -->
${PRINTOUT_LINK_OVERRIDE}

<!-- Stub out the remaining file writers (every other template reachable    -->
<!-- from pretext-html.xsl that contains exsl:document). Under portable-    -->
<!-- html several of these are already suppressed; the stubs cover the      -->
<!-- rest and act as a safety net if publication settings change. Any       -->
<!-- exsl:document that does fire aborts the FILESYSTEM=0 WASM build.       -->
${FILE_WRITER_STUBS}

</xsl:stylesheet>
`;

  fs.writeFileSync(path.join(assetsDir, "preview-html.xsl"), wrapper);
  console.log("Generated assets/preview-html.xsl");
}

/**
 * Generate assets/preview-revealjs.xsl, the slideshow counterpart.
 *
 * Far thinner than preview-html.xsl, because pretext-revealjs.xsl already
 * overrides the entry template to emit one monolithic page with no chunking —
 * there is no <exsl:document> to excise from the page-building path, so no
 * upstream template needs copying. The wrapper adds exactly two things:
 *
 *   1. the shared file-writer stubs (an <interactive> on a slide really does
 *      reach "create-iframe-page" — measured, not theoretical), and
 *   2. an @id on every slide and section.
 *
 * The ids are what the preview's source map keys on (see src/sourcemap.ts):
 * upstream emits bare <section> elements, so without this an editor has no
 * anchor in the page to scroll to. They are added without copying the upstream
 * templates — <xsl:apply-imports/> renders the slide exactly as upstream would,
 * into a result tree fragment, and the element is then re-emitted with the id
 * spliced in. So this survives upstream edits to the slide markup.
 */
function generatePreviewRevealXsl() {
  const wrapper = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  GENERATED FILE - do not edit by hand.
  Regenerate with: npm run refresh-xsl -w @pretextbook/pretext-html

  Wrapper around pretext-revealjs.xsl for in-memory reveal.js slideshow builds
  (previews). The reveal.js conversion is already a single-page conversion, so
  unlike preview-html.xsl this copies no upstream template: it stubs the file
  writers (which a slide holding an "interactive" would otherwise trip) and
  stamps the ids the preview's source map needs onto slides and sections.

  Intended to be applied together with a publication file that forces
  <revealjs><resources host="cdn" math="online"/></revealjs>, since neither
  locally hosted nor embedded reveal.js resources exist for an in-memory build.
-->
<xsl:stylesheet
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
    xmlns:exsl="http://exslt.org/common"
    extension-element-prefixes="exsl"
>

<xsl:import href="pretext-revealjs.xsl"/>
<xsl:output method="html" encoding="UTF-8" doctype-system="about:legacy-compat"/>

<!-- Stamp @id onto the reveal.js "section" that upstream builds for each     -->
<!-- slide (and each section of slides), without reproducing any of the       -->
<!-- upstream markup: render it via apply-imports, then re-emit the result    -->
<!-- with the id added to its first element. The id is the same @unique-id    -->
<!-- the rest of PreTeXt's HTML uses, which is what makes it findable from    -->
<!-- the source map. Attributes are copied before the id is set, so an        -->
<!-- upstream id (if one is ever added) is overridden rather than             -->
<!-- duplicated, and both precede any child content, as XSLT requires.        -->
<!--                                                                         -->
<!-- Only the *first* element is stamped, because a "section" does not always -->
<!-- render as one element: under the "linear" navigation mode upstream emits -->
<!-- the section's title slide followed by its slides as siblings. Those      -->
<!-- slides were rendered through this same template and carry their own ids  -->
<!-- already, so stamping every top-level element would duplicate the         -->
<!-- section's id across all of them.                                         -->
<xsl:template match="slide|section">
    <xsl:variable name="preview-id">
        <xsl:apply-templates select="." mode="html-id"/>
    </xsl:variable>
    <xsl:variable name="rendered">
        <xsl:apply-imports/>
    </xsl:variable>
    <!-- Bound once: two exsl:node-set calls on one fragment are not obliged -->
    <!-- to yield the same node identities, which the comparison relies on.  -->
    <xsl:variable name="tree" select="exsl:node-set($rendered)"/>
    <xsl:for-each select="$tree/node()">
        <xsl:choose>
            <xsl:when test="generate-id() = generate-id($tree/*[1])">
                <xsl:copy>
                    <xsl:copy-of select="@*"/>
                    <xsl:attribute name="id">
                        <xsl:value-of select="$preview-id"/>
                    </xsl:attribute>
                    <xsl:copy-of select="node()"/>
                </xsl:copy>
            </xsl:when>
            <xsl:otherwise>
                <xsl:copy-of select="."/>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:for-each>
</xsl:template>

<!-- Same file-writer stubs as preview-html.xsl; see FILE_WRITER_STUBS. -->
${FILE_WRITER_STUBS}

</xsl:stylesheet>
`;

  fs.writeFileSync(path.join(assetsDir, "preview-revealjs.xsl"), wrapper);
  console.log("Generated assets/preview-revealjs.xsl");
}

// Templates containing an exsl:document that the wrapper neutralizes, either
// by overriding the whole template (file-wrap) or by stubbing it. If upstream
// adds a *new* file writer, the preview would abort at transform time (the
// WASM build has no filesystem), so fail here instead, at refresh time.
const KNOWN_WRITER_TEMPLATES = new Set([
  "mode=file-wrap",
  "mode=simple-file-wrap",
  "mode=manufacture-knowl",
  "mode=standalone-page",
  "mode=create-iframe-page",
  "mode=runestone-manifest",
  "name=index-redirect-page",
  "name=ol-marker-styles",
  "name=doc-manifest",
  "name=search-page-construction",
  "name=scorm-manifest",
]);

/**
 * Every stylesheet reachable from the preview entry points via import/include.
 * pretext-revealjs.xsl imports pretext-html.xsl, so it contributes only itself
 * — but it is listed explicitly so a future reveal-only import is still
 * audited.
 */
function reachableStylesheets() {
  const seen = new Set();
  const queue = ["pretext-html.xsl", "pretext-revealjs.xsl"];
  while (queue.length > 0) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    const file = path.join(xslDir, name);
    if (!fs.existsSync(file)) continue;
    seen.add(name);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /<xsl:(?:import|include)\s+href="\.?\/?([^"]+)"/g,
    )) {
      queue.push(match[1]);
    }
  }
  return [...seen];
}

function checkFileWriters() {
  const unexpected = [];
  for (const name of reachableStylesheets()) {
    const text = fs.readFileSync(path.join(xslDir, name), "utf8");
    let templateKey = "(top level)";
    for (const match of text.matchAll(
      /<xsl:template\b[^>]*>|<exsl:document\b/g,
    )) {
      if (match[0].startsWith("<xsl:template")) {
        const mode = /mode="([^"]+)"/.exec(match[0])?.[1];
        const tname = /name="([^"]+)"/.exec(match[0])?.[1];
        templateKey = mode
          ? `mode=${mode}`
          : tname
            ? `name=${tname}`
            : "(anonymous)";
      } else if (!KNOWN_WRITER_TEMPLATES.has(templateKey)) {
        unexpected.push(
          `${name}: exsl:document inside template ${templateKey}`,
        );
      }
    }
  }
  if (unexpected.length > 0) {
    throw new Error(
      "Upstream added file-writing templates the preview wrapper does not " +
        "stub. Add stubs to generatePreviewXsl() (and KNOWN_WRITER_TEMPLATES) " +
        "for:\n  " +
        unexpected.join("\n  "),
    );
  }
  console.log("File-writer audit passed: all exsl:document sites are stubbed.");
}

function writeProvenance(source) {
  const info = {
    source,
    refreshed: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(assetsDir, "upstream.json"),
    `${JSON.stringify(info, null, 2)}\n`,
  );
}

async function main() {
  fs.mkdirSync(assetsDir, { recursive: true });
  // --generate-only rebuilds the wrappers from the stylesheets already
  // vendored, leaving assets/xsl and upstream.json untouched. For iterating on
  // wrapper generation without re-downloading (and without silently moving the
  // vendored tree to a newer upstream than the one that was reviewed).
  if (generateOnly) {
    console.log("Regenerating wrappers only; vendored stylesheets untouched.");
  } else if (localDir) {
    copyXslTree(path.resolve(localDir));
    writeProvenance({ local: path.resolve(localDir) });
  } else {
    const tmpDir = await fetchUpstreamXsl();
    copyXslTree(tmpDir);
    writeProvenance({ repository: "PreTeXtBook/pretext", ref });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  generatePreviewXsl();
  generatePreviewRevealXsl();
  checkFileWriters();
  if (!generateOnly) {
    // Not derived from the vendored stylesheets — it is read from the
    // html-static CDN — so it is skipped along with the rest of the network
    // work under --generate-only. See scripts/refresh-runestone.mjs.
    await refreshRunestoneServices();
    warnIfBundleStale();
  }
}

/**
 * assets/xsl-bundle.json is a recording of the stylesheets a render touched
 * (see scripts/build-xsl-bundle.mjs), and a refresh has just replaced those
 * stylesheets underneath it. A *missing* bundle degrades gracefully — the
 * browser host falls back to per-file fetches — but a stale one serves the
 * pre-refresh stylesheets to the browser build, mixing two upstream revisions
 * into one transform, which fails as an opaque "failed to apply XSLT
 * stylesheet". Regenerating it needs a current dist/, so it cannot happen
 * here; say so instead of leaving it to be discovered as a test failure.
 */
function warnIfBundleStale() {
  const bundlePath = path.join(assetsDir, "xsl-bundle.json");
  if (!fs.existsSync(bundlePath)) {
    return;
  }
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const stale = Object.entries(bundle).some(([name, contents]) => {
    const file = path.join(xslDir, name);
    return !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== contents;
  });
  if (stale) {
    console.warn(
      "\nassets/xsl-bundle.json is now STALE and will break the browser " +
        "build.\nRegenerate it with:\n\n  npm run build -w @pretextbook/pretext-html\n",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
