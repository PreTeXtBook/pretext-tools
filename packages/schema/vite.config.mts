/// <reference types='vitest' />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import * as path from "path";

/**
 * Two builds from one source tree.
 *
 * `vite build` produces the Node build (`dist/index.js`/`.cjs`); `vite build
 * --mode browser` produces the browser build (`dist/index.browser.js`), which
 * differs only in what the platform seam resolves to — see
 * src/platform.ts/platform.browser.ts. Types are shared: the exported surface
 * is identical either way, so the browser build skips its own `dts` pass and
 * the "browser" export condition in package.json points at the Node build's
 * declarations.
 */
export default defineConfig(({ mode }) => {
  const isBrowser = mode === "browser";

  return {
    root: import.meta.dirname,
    cacheDir: "../../node_modules/.vite/packages/schema",
    plugins: isBrowser
      ? []
      : [
          dts({
            entryRoot: "src",
            tsconfigPath: path.join(import.meta.dirname, "tsconfig.lib.json"),
            pathsToAliases: false,
          }),
        ],
    resolve: isBrowser
      ? {
          alias: {
            "./platform": path.join(
              import.meta.dirname,
              "src/platform.browser.ts",
            ),
          },
        }
      : {},
    build: {
      outDir: "dist",
      // The browser build runs second and must not wipe the Node build.
      emptyOutDir: !isBrowser,
      reportCompressedSize: true,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
      lib: {
        entry: isBrowser
          ? { "index.browser": "src/index.ts" }
          : {
              index: "src/index.ts",
              compile: "src/compile.ts",
            },
        fileName: (format, entry) =>
          format === "es" ? `${entry}.js` : `${entry}.cjs`,
        // ESM only for the browser build: no CJS bundler is fetching a
        // browser build via require().
        formats: isBrowser ? ["es"] : ["es", "cjs"],
      },
      rollupOptions: {
        // Runtime dependencies are resolved from node_modules, not bundled —
        // downstream bundlers apply their own "browser" field for these (e.g.
        // salve-annos ships one) when bundling for the browser themselves.
        external: isBrowser
          ? ["salve-annos", "saxes", "xregexp", "vscode-languageserver-types"]
          : [
              // The browser build must not leave any node builtin import
              // behind: there is no shim for it downstream, so a stray one is
              // a hard failure in a bundler. Marking them external only for
              // the Node build means rollup fails the browser build instead
              // of silently emitting an unresolvable import.
              "salve-annos",
              "saxes",
              "xregexp",
              "vscode-languageserver-types",
              "fs",
              "path",
              "url",
              "module",
              "node:fs",
              "node:path",
              "node:url",
              "node:module",
            ],
      },
    },
    test: {
      name: "schema",
      watch: false,
      globals: true,
      environment: "node",
      include: ["{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
      reporters: ["default"],
      coverage: {
        reportsDirectory: "../../coverage/packages/schema",
        provider: "v8" as const,
      },
    },
  };
});
