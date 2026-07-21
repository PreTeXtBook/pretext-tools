/// <reference types='vitest' />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import * as path from "path";
import { createRequire } from "node:module";

const { version } = createRequire(import.meta.url)("./package.json") as {
  version: string;
};

const external = [
  /^@pretextbook\/libxslt-wasm/,
  "xast-util-from-xml",
  "xast-util-to-xml",
];

/**
 * Two builds from one source tree.
 *
 * `vite build` produces the Node build; `vite build --mode browser` produces
 * the browser build, which differs only in what the platform seam resolves to
 * (see src/host.ts). The browser build additionally substitutes a posix-only
 * `node:path` — safe because every path this package computes is virtual, not
 * a real filesystem path (see src/internal/posix-path.ts) — and drops the CLI
 * entry, which genuinely needs Node.
 */
export default defineConfig(({ mode }) => {
  const isBrowser = mode === "browser";

  return {
    root: import.meta.dirname,
    cacheDir: "../../node_modules/.vite/packages/pretext-html",
    // Only the Node build emits declarations; the browser build shares them,
    // and a second dts pass would race it writing the same files.
    plugins: isBrowser
      ? []
      : [
          dts({
            entryRoot: "src",
            tsconfigPath: path.join(import.meta.dirname, "tsconfig.lib.json"),
            pathsToAliases: false,
          }),
        ],
    ...(isBrowser
      ? {
          define: {
            // Pins the default jsDelivr assets URL to this exact version, so
            // the stylesheets a browser fetches always match the renderer.
            __PKG_VERSION__: JSON.stringify(version),
          },
          resolve: {
            alias: {
              "./host.js": path.join(
                import.meta.dirname,
                "src/host.browser.ts",
              ),
              "node:path": path.join(
                import.meta.dirname,
                "src/internal/posix-path.ts",
              ),
            },
          },
        }
      : {}),
    build: {
      outDir: "dist",
      // The browser build runs second and must not wipe the Node build.
      emptyOutDir: !isBrowser,
      reportCompressedSize: true,
      target: isBrowser ? "es2022" : "node22",
      lib: {
        entry: isBrowser
          ? { "index.browser": "src/index.browser.ts" }
          : {
              index: "src/index.ts",
              cli: "src/cli.ts",
              // Dependency-free theme protocol, published as the "./theme"
              // subpath so embedders can import it without the WASM renderer
              // graph.
              theme: "src/theme.ts",
              // Likewise for the asset-URL rewriter: the VS Code extension
              // host applies it to HTML the *worker* rendered, so it needs the
              // helper without libxslt-wasm's top-level await.
              assets: "src/assets.ts",
            },
        // ESM only: @pretextbook/libxslt-wasm is ESM-only and needs JSPI
        // anyway, so there is no CommonJS audience for this package.
        formats: ["es" as const],
      },
      rollupOptions: {
        // The browser build must not leave any `node:` import behind: there is
        // no shim for it downstream, so a stray one is a hard failure in a
        // bundler. Keeping them non-external means rollup fails the build
        // instead of silently emitting an unresolvable import.
        external: isBrowser ? external : [...external, /^node:/],
      },
    },
    test: {
      name: "pretext-html",
      watch: false,
      globals: true,
      environment: "node",
      include: ["src/**/*.{test,spec}.ts"],
      reporters: ["default"],
      testTimeout: 60000,
      // libxslt-wasm needs WebAssembly JSPI, which Node gates behind a flag
      // that must reach the worker processes actually running the tests.
      execArgv: ["--experimental-wasm-jspi"],
      coverage: {
        reportsDirectory: "../../coverage/packages/pretext-html",
        provider: "v8" as const,
      },
    },
  };
});
