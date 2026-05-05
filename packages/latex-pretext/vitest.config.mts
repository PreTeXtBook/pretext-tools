import { defineConfig } from "vitest/config";

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/packages/tex2ptx",
  plugins: [],
  test: {
    name: "tex2ptx",
    watch: false,
    globals: true,
    environment: "node",
    include: ["{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/packages/tex2ptx",
      provider: "v8" as const,
    },
  },
}));
