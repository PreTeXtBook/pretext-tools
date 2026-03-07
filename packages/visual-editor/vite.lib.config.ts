import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import dts from "vite-plugin-dts";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/main.tsx",
        "src/App.tsx",
        "src/ptxSourceSlice.ts",
      ],
      rollupTypes: true,
      tsconfigPath: resolve(__dirname, "tsconfig.lib.json"),
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "@pretextbook/visual-editor",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      // Externalize deps that shouldn't be bundled in the library
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "@tiptap/react",
        "@tiptap/core",
        "@tiptap/pm",
        "@tiptap/extensions",
        "@tiptap/extension-code-block",
        "@tiptap/extension-list",
        "@floating-ui/dom",
        "katex",
      ],
      output: {
        // Provide global variables for externalized deps in UMD build
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "style.css";
          }
          return "[name].[ext]";
        },
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
