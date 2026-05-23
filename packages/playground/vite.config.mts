import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: '../../dist/packages/playground',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        compare: 'format-compare.html',
      },
    },
  },
  server: {
    open: true,
  },
  resolve: {
    conditions: ['import', 'module', 'browser', 'default'],
  },
  optimizeDeps: {
    include: ['unified', 'remark-parse', 'remark-directive', 'remark-math'],
  },
});
