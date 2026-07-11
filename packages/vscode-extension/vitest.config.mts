import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Fast, Node-only unit tests for logic that does not import the `vscode`
    // module. The `src/test/` directory holds Mocha integration tests that run
    // inside a real VS Code instance (via @vscode/test-cli) and must be
    // excluded here.
    include: ['src/**/*.spec.ts'],
    exclude: ['src/test/**', 'node_modules/**', 'out/**'],
  },
});
