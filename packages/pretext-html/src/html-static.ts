/**
 * GENERATED FILE - do not edit by hand.
 * Regenerate with: npm run refresh-runestone -w @pretextbook/pretext-html
 *
 * The html-static release the preview loads all of its CDN assets from, and
 * the Runestone Services bundle that release ships in `dist/_static/`.
 *
 * These belong together and are captured together: the bundle filenames are
 * content-hashed, so they are only valid for this one release. See
 * scripts/refresh-runestone.mjs for why that means the release is pinned
 * rather than tracked as "latest".
 */

/** html-static release, passed to the stylesheets as `cli.version`. */
export const HTML_STATIC_VERSION = "2.57.0";

/** Runestone Services release built into it, reported as `eBookConfig.runestone_version`. */
export const RUNESTONE_VERSION = "8.4.3";

/** Scripts that turn Runestone's inert exercise markup into working exercises. */
export const RUNESTONE_JS: readonly string[] = [
  "prefix-runtime.90336ab72cbb648f.bundle.js",
  "prefix-23.7d27cb317c36911a.bundle.js",
  "prefix-runestone.1f0ec0deacd7bb16.bundle.js",
];

/** Stylesheets those scripts expect. */
export const RUNESTONE_CSS: readonly string[] = [
  "prefix-runestone.52ceae47a9e6e8ed.css",
];
