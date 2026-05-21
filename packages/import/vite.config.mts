/// <reference types='vitest' />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import * as path from "path";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/packages/import",
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
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: {
        index: path.resolve(import.meta.dirname, "src/index.ts"),
        react: path.resolve(import.meta.dirname, "src/react/index.ts"),
      },
      name: "import",
      fileName: (format, entryName) =>
        `${entryName}.${format === "es" ? "js" : "cjs"}`,
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "@pretextbook/format",
        "@pretextbook/latex-pretext",
        "@pretextbook/remark-pretext",
      ],
    },
  },
  test: {
    name: "import",
    watch: false,
    globals: true,
    environment: "node",
    include: ["{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/packages/import",
      provider: "v8" as const,
    },
  },
}));
