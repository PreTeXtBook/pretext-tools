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
export const HTML_STATIC_VERSION = "2.45.0";

/** Runestone Services release built into it, reported as `eBookConfig.runestone_version`. */
export const RUNESTONE_VERSION = "8.1.16";

/** Scripts that turn Runestone's inert exercise markup into working exercises. */
export const RUNESTONE_JS: readonly string[] = [
  "prefix-runtime.279b1f0077454c32.bundle.js",
  "prefix-926.5c7038c8ef173faf.bundle.js",
  "prefix-runestone.db8001875cb726c2.bundle.js",
];

/** Stylesheets those scripts expect. */
export const RUNESTONE_CSS: readonly string[] = [
  "prefix-926.229729d09512acc9.css",
  "prefix-runestone.66fa8a682a32c0ac.css",
];
