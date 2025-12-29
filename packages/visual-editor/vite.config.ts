import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "../../dist/vscode-extension/out/media"), // Output to the dist media folder
    rollupOptions: {
      output: {
        entryFileNames: "visualEditor.js", // Output JavaScript file name
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "assets/visualEditor.css"; // Place CSS file in assets folder
          }
          return "assets/[name].[ext]"; // Place other assets in assets folder
        },
      },
    },
  },
});
