/// <reference types='vitest' />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import * as path from "path";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/packages/pretext-html",
  plugins: [
    dts({
      entryRoot: "src",
      tsconfigPath: path.join(import.meta.dirname, "tsconfig.lib.json"),
      pathsToAliases: false,
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    reportCompressedSize: true,
    target: "node22",
    lib: {
      entry: {
        index: "src/index.ts",
        cli: "src/cli.ts",
      },
      // ESM only: @pretextbook/libxslt-wasm is ESM-only and needs JSPI anyway,
      // so there is no CommonJS audience for this package.
      formats: ["es" as const],
    },
    rollupOptions: {
      external: [
        /^@pretextbook\/libxslt-wasm/,
        "xast-util-from-xml",
        "xast-util-to-xml",
        /^node:/,
      ],
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
}));
