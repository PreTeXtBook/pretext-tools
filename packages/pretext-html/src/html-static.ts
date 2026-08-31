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
export const HTML_STATIC_VERSION = "2.51.0";

/** Runestone Services release built into it, reported as `eBookConfig.runestone_version`. */
export const RUNESTONE_VERSION = "8.2.9";

/** Scripts that turn Runestone's inert exercise markup into working exercises. */
export const RUNESTONE_JS: readonly string[] = [
  "prefix-runtime.5ef53875c58b216b.bundle.js",
  "prefix-926.5c7038c8ef173faf.bundle.js",
  "prefix-runestone.c5ba0ffa5f963084.bundle.js",
];

/** Stylesheets those scripts expect. */
export const RUNESTONE_CSS: readonly string[] = [
  "prefix-926.229729d09512acc9.css",
  "prefix-runestone.efe427683fc41f98.css",
];
