/// <reference types='vitest' />
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import * as path from 'path';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/ptxast-util-from-xml',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
      pathsToAliases: false,
    }),
  ],
  build: {
    outDir: '../../dist/packages/ptxast-util-from-xml',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: 'src/index.ts',
      name: 'ptxast-util-from-xml',
      fileName: (format) => format === 'es' ? 'index.js' : 'index.cjs',
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [
        '@pretextbook/ptxast',
        'xast-util-from-xml',
      ],
    },
  },
  test: {
    name: 'ptxast-util-from-xml',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/packages/ptxast-util-from-xml',
      provider: 'v8' as const,
    },
  },
}));
