import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
// Dev server config for the visual-editor demo app
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-demo",
  },
});
