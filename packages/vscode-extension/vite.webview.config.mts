import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, "../../dist/vscode-extension/out/media"),
    // In watch mode the import-wizard bundle (vite.webview-import.config.mts)
    // shares this outDir, so emptying it on every rebuild would delete
    // importWizard.js and blank out the import panel. Only empty on one-shot
    // builds, where build:webview runs this config first, then the import one.
    emptyOutDir: !process.argv.includes("--watch"),
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      output: {
        entryFileNames: "visualEditor.js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "assets/visualEditor.css";
          }
          return "assets/[name].[ext]";
        },
      },
    },
  },
});
