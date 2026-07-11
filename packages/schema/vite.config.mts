/// <reference types='vitest' />
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import * as path from 'path';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/schema',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
      pathsToAliases: false,
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: {
        index: 'src/index.ts',
        compile: 'src/compile.ts',
      },
      fileName: (format, entry) =>
        format === 'es' ? `${entry}.js` : `${entry}.cjs`,
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      // Runtime dependencies are resolved from node_modules, not bundled.
      external: [
        'salve-annos',
        'saxes',
        'xregexp',
        'vscode-languageserver-types',
        'fs',
        'path',
        'url',
        'module',
        'node:fs',
        'node:path',
        'node:url',
        'node:module',
      ],
    },
  },
  test: {
    name: 'schema',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/packages/schema',
      provider: 'v8' as const,
    },
  },
}));
