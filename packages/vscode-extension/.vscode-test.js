const path = require("path");
const { defineConfig } = require("@vscode/test-cli");

// The runnable extension (bundled JS + assets + a trimmed package.json) is
// assembled under dist/vscode-extension by the build. Point VS Code there as
// the extension under test, while the compiled Mocha tests live in ./out/test.
const extensionDevelopmentPath = path.resolve(
  __dirname,
  "../../dist/vscode-extension",
);

module.exports = defineConfig({
  files: "out/test/**/*.test.js",
  version: "stable",
  extensionDevelopmentPath,
  // Open the fixture project so the `workspaceContains:project.ptx` activation
  // event fires and the extension activates.
  workspaceFolder: path.resolve(__dirname, "src/test/fixtures/sample-project"),
  mocha: {
    ui: "tdd",
    timeout: 30000,
  },
});
