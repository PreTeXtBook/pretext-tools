import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Builds the import-wizard webview bundle. Run after the visual-editor
// webview build (vite.webview.config.mts), which empties the shared outDir.
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, "../../dist/vscode-extension/out/media"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "import.html"),
      output: {
        entryFileNames: "importWizard.js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "assets/importWizard.css";
          }
          return "assets/[name].[ext]";
        },
      },
    },
  },
});
