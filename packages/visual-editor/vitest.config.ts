/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for @pretextbook/visual-editor.
 *
 * This lives in its own file (rather than a `test` block inside
 * vite.config.ts / vite.lib.config.ts) because the package has two Vite
 * configs already — the dev/demo app and the library build — and vitest
 * automatically prefers vitest.config.ts over either, which keeps the test
 * environment independent of whichever build config happens to be active.
 *
 * The important setting is `environment: "jsdom"`: the round-trip harness
 * parses PreTeXt through TipTap's `generateJSON`, which uses the browser
 * `DOMParser`. jsdom provides it headlessly (jsdom is a root-level
 * devDependency of the monorepo). Sibling library packages use
 * `environment: "node"`; this one genuinely needs a DOM.
 */
export default defineConfig({
  test: {
    name: "visual-editor",
    watch: false,
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/packages/visual-editor",
      provider: "v8" as const,
    },
  },
});
