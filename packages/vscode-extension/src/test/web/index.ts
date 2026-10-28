/**
 * Entry point for the browser (Web Worker) test run driven by
 * `@vscode/test-web`. Mocha runs inside the worker, so it is loaded from its
 * browser build and the test modules are required explicitly — there is no
 * filesystem to glob. They are required *after* `mocha.setup`, which is what
 * defines the `suite`/`test` globals they register with (a static `import`
 * would be hoisted above it).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("mocha/mocha");

declare const mocha: BrowserMocha;

export function run(): Promise<void> {
  return new Promise((resolve, reject) => {
    mocha.setup({ ui: "tdd", reporter: undefined, timeout: 20000 });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./activation.test");
    try {
      mocha.run((failures) =>
        failures > 0
          ? reject(new Error(`${failures} tests failed.`))
          : resolve(),
      );
    } catch (err) {
      reject(err);
    }
  });
}
