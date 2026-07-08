// Refresh the vendored PreTeXt XSL stylesheets from upstream and regenerate
// the preview wrapper stylesheet.
//
// Usage:
//   node scripts/refresh-xsl.mjs               # fetch PreTeXtBook/pretext master
//   node scripts/refresh-xsl.mjs --ref <ref>   # fetch a specific branch/tag/commit
//   node scripts/refresh-xsl.mjs --local <dir> # copy from a local pretext checkout
//
// The wrapper stylesheet (assets/preview-html.xsl) is generated, not
// hand-maintained: it contains a verbatim copy of the upstream "file-wrap"
// template with the <exsl:document> wrapper removed, so the whole document is
// emitted as a single complete HTML page on the main result tree. Regenerating
// it here keeps the copy in lockstep with the vendored stylesheets.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function fetchUpstreamXsl() {
  const url = `https://codeload.github.com/PreTeXtBook/pretext/tar.gz/refs/heads/${ref}`;
  console.log(`Downloading ${url} ...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download pretext tarball (${response.status})`);
  }
  const tarball = Buffer.from(await response.arrayBuffer());

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pretext-xsl-"));
  const tarPath = path.join(tmpDir, "pretext.tar.gz");
  fs.writeFileSync(tarPath, tarball);
  execFileSync("tar", [
    "-xzf",
    tarPath,
    "-C",
    tmpDir,
    "--strip-components=1",
    "--wildcards",
    "*/xsl",
    "*/LICENSE*",
  ]);
  return tmpDir;
}

function copyXslTree(sourceRoot) {
  const sourceXsl = path.join(sourceRoot, "xsl");
  if (!fs.existsSync(path.join(sourceXsl, "pretext-html.xsl"))) {
    throw new Error(`No pretext-html.xsl found under ${sourceXsl}`);
  }
  fs.rmSync(xslDir, { recursive: true, force: true });
  fs.cpSync(sourceXsl, xslDir, { recursive: true });
  // Ship the upstream license alongside the vendored (GPL-licensed) files
  for (const name of ["LICENSE", "LICENSE.txt", "LICENSE.md"]) {
    const licensePath = path.join(sourceRoot, name);
    if (fs.existsSync(licensePath)) {
      fs.copyFileSync(licensePath, path.join(xslDir, "LICENSE-pretext"));
      break;
    }
  }
  console.log(`Copied XSL tree to ${xslDir}`);
}

/**
 * Generate assets/preview-html.xsl.
 *
 * Extracts the body of the `file-wrap` template from the vendored
 * pretext-html.xsl and strips the <exsl:document> element (keeping its
 * children) so the page lands on the main result tree instead of aborting in
 * the FILESYSTEM=0 WASM build. All other file-writing templates are stubbed;
 * most are already suppressed by the portable-html publication setting the
 * renderer forces.
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

<!-- Stub out the remaining file writers (every other template reachable    -->
<!-- from pretext-html.xsl that contains exsl:document). Under portable-    -->
<!-- html several of these are already suppressed; the stubs cover the      -->
<!-- rest and act as a safety net if publication settings change. Any       -->
<!-- exsl:document that does fire aborts the FILESYSTEM=0 WASM build.       -->
<xsl:template name="index-redirect-page"/>
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
</xsl:template>

</xsl:stylesheet>
`;

  fs.writeFileSync(path.join(assetsDir, "preview-html.xsl"), wrapper);
  console.log("Generated assets/preview-html.xsl");
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
 * Every stylesheet reachable from pretext-html.xsl via import/include.
 */
function reachableStylesheets() {
  const seen = new Set();
  const queue = ["pretext-html.xsl"];
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
  if (localDir) {
    copyXslTree(path.resolve(localDir));
    writeProvenance({ local: path.resolve(localDir) });
  } else {
    const tmpDir = await fetchUpstreamXsl();
    copyXslTree(tmpDir);
    writeProvenance({ repository: "PreTeXtBook/pretext", ref });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  generatePreviewXsl();
  checkFileWriters();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
