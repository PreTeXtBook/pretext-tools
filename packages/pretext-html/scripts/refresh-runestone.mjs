// Capture the Runestone Services bundle filenames the preview links to, and
// the html-static release they came from.
//
// Usage:
//   node scripts/refresh-runestone.mjs              # newest html-static release
//   node scripts/refresh-runestone.mjs --html-static <version>
//
// Run on its own, or as part of `refresh-xsl.mjs` (which calls it).
//
// Why this exists
// ---------------
// Runestone's interactive exercises (multiple choice, Parsons, fill-in-the-
// blank, ActiveCode, ...) are rendered as inert markup by the stylesheets —
// `<div data-component="parsons">` and friends — and brought to life by
// "Runestone Services", a webpack bundle. Upstream links that bundle from the
// `rs-js` / `rs-css` / `rs-version` string parameters, which the *Python* CLI
// fills in after reading a manifest. Leave them empty, as this renderer did
// until now, and the exercises render as dead markup: present, styled, and
// completely unresponsive.
//
// This has nothing to do with `<platform runestone="yes">`. That selects
// server-side hosting (accounts, grade storage, `$b-host-runestone`); the
// components themselves are client-side JavaScript and work identically in an
// ordinary web build. Both kinds of build link the same bundle.
//
// Why the filenames are captured rather than hard-coded
// -----------------------------------------------------
// The bundle files are content-hashed (`prefix-runestone.<hash>.bundle.js`), so
// the names change on every Runestone Services release. They are served from
// the same html-static CDN release as PreTeXt's own css/js — `$cdn-prefix` +
// `_static/` — and html-static publishes the manifest naming them alongside
// them, in `dist/_static/webpack_static_imports.xml`.
//
// Since the names are only valid for the html-static release they were read
// from, that release is captured too, and the renderer pins `cli.version` to
// it. Pinning is what makes this safe: with `@latest` the hashes would silently
// 404 the day html-static rebuilt its bundles, taking every interactive
// exercise in the preview with them and leaving no trace in the rendered HTML.
// (The stale copy in assets/xsl/support/webpack_static_imports.xml, vendored
// from upstream at Runestone 7.4.4, is exactly that failure: every filename in
// it is now a 404.)
//
// Note this is a *different* manifest from that vendored one. Upstream's is
// fetched from runestone.academy and names the newest Runestone Services
// release, which is not necessarily the one built into the html-static release
// the rest of the page loads from. Reading html-static's own copy is what keeps
// the bundle consistent with everything around it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const generatedFile = path.join(packageRoot, "src", "html-static.ts");

const JSDELIVR_DATA =
  "https://data.jsdelivr.com/v1/packages/gh/PreTeXtBook/html-static";

const cdnBase = (version) =>
  `https://cdn.jsdelivr.net/gh/PreTeXtBook/html-static@${version}/dist/`;

/**
 * Newest published html-static release, as jsDelivr sees it.
 *
 * jsDelivr's `versions` array is ordered newest-first and holds only versions
 * it can actually serve, which is the property that matters here — a git tag
 * it has not indexed would resolve to nothing at render time. Its `tags.latest`
 * is empty for this repository, hence reading the array directly.
 */
async function newestHtmlStaticVersion() {
  const response = await fetch(JSDELIVR_DATA);
  if (!response.ok) {
    throw new Error(
      `Could not list html-static releases (${response.status} from jsDelivr).`,
    );
  }
  const data = await response.json();
  const version = data.versions?.[0]?.version;
  if (!version) {
    throw new Error(
      "jsDelivr listed no html-static versions. Its API response shape has " +
        "changed; refresh-runestone.mjs needs updating.",
    );
  }
  return version;
}

/** Read the `<item>` values out of one `<js>`/`<css>` list in the manifest. */
function parseList(xml, tag) {
  const block = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!block) {
    throw new Error(
      `No <${tag}> list in webpack_static_imports.xml. Its format has ` +
        `changed; refresh-runestone.mjs needs updating.`,
    );
  }
  const items = [...block[1].matchAll(/<item[^>]*>([^<]+)<\/item>/g)].map(
    (match) => match[1].trim(),
  );
  if (items.length === 0) {
    throw new Error(
      `The <${tag}> list in webpack_static_imports.xml is empty.`,
    );
  }
  // The two lists reach the stylesheet as single colon-delimited strings, which
  // it splits with str:tokenize (see pretext-runestone.xsl). A colon in a
  // filename would split into two nonexistent files, so reject it here rather
  // than emit two 404s.
  const bad = items.filter((item) => item.includes(":"));
  if (bad.length > 0) {
    throw new Error(
      `Runestone Services filenames must not contain ":" (they are passed ` +
        `as a colon-delimited list): ${bad.join(", ")}`,
    );
  }
  return items;
}

/**
 * Confirm every captured file is actually served from the release it was read
 * from. The manifest and the bundles are separate files in the same directory,
 * and nothing guarantees a release shipped both — a mismatch here is precisely
 * the silent breakage this capture exists to prevent, so fail now, loudly,
 * rather than at render time, invisibly.
 */
async function verifyServed(version, files) {
  const missing = [];
  await Promise.all(
    files.map(async (file) => {
      const url = `${cdnBase(version)}_static/${file}`;
      // A ranged GET: jsDelivr answers HEAD inconsistently across its cache
      // tiers, and one byte is cheap enough to just ask for.
      const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
      if (!response.ok) {
        missing.push(`${response.status} ${url}`);
      }
    }),
  );
  if (missing.length > 0) {
    throw new Error(
      `html-static@${version} does not serve every file its own manifest ` +
        `names:\n  ${missing.join("\n  ")}`,
    );
  }
}

function generateModule({ htmlStaticVersion, runestoneVersion, js, css }) {
  const list = (items) =>
    items.map((item) => `  ${JSON.stringify(item)},`).join("\n");

  return `/**
 * GENERATED FILE - do not edit by hand.
 * Regenerate with: npm run refresh-runestone -w @pretextbook/pretext-html
 *
 * The html-static release the preview loads all of its CDN assets from, and
 * the Runestone Services bundle that release ships in \`dist/_static/\`.
 *
 * These belong together and are captured together: the bundle filenames are
 * content-hashed, so they are only valid for this one release. See
 * scripts/refresh-runestone.mjs for why that means the release is pinned
 * rather than tracked as "latest".
 */

/** html-static release, passed to the stylesheets as \`cli.version\`. */
export const HTML_STATIC_VERSION = ${JSON.stringify(htmlStaticVersion)};

/** Runestone Services release built into it, reported as \`eBookConfig.runestone_version\`. */
export const RUNESTONE_VERSION = ${JSON.stringify(runestoneVersion)};

/** Scripts that turn Runestone's inert exercise markup into working exercises. */
export const RUNESTONE_JS: readonly string[] = [
${list(js)}
];

/** Stylesheets those scripts expect. */
export const RUNESTONE_CSS: readonly string[] = [
${list(css)}
];
`;
}

export async function refreshRunestoneServices({ htmlStatic } = {}) {
  const version = htmlStatic ?? (await newestHtmlStaticVersion());
  const manifestUrl = `${cdnBase(version)}_static/webpack_static_imports.xml`;
  console.log(`Reading ${manifestUrl} ...`);
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(
      `Could not read html-static@${version}'s Runestone manifest ` +
        `(${response.status}). Does that release exist?`,
    );
  }
  const manifest = await response.text();

  const js = parseList(manifest, "js");
  const css = parseList(manifest, "css");
  const runestoneVersion = /<version[^>]*>([^<]+)<\/version>/
    .exec(manifest)?.[1]
    ?.trim();
  if (!runestoneVersion) {
    throw new Error(
      "No <version> in webpack_static_imports.xml. Its format has changed; " +
        "refresh-runestone.mjs needs updating.",
    );
  }

  await verifyServed(version, [...js, ...css]);

  fs.writeFileSync(
    generatedFile,
    generateModule({
      htmlStaticVersion: version,
      runestoneVersion,
      js,
      css,
    }),
  );
  console.log(
    `Generated src/html-static.ts (html-static ${version}, ` +
      `Runestone Services ${runestoneVersion}, ${js.length} js + ${css.length} css)`,
  );
}

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

// Only when run directly, so refresh-xsl.mjs can import the function.
// Compared as a file URL, since a Windows path is not `file://` + argv[1].
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  refreshRunestoneServices({ htmlStatic: getArg("--html-static") }).catch(
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
