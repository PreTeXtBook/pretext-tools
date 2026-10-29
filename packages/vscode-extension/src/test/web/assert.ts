/**
 * The few assertions the web smoke tests need. Node's `assert` is not
 * available in the Web Worker host and the test bundle is built for the
 * browser, so this stands in for it.
 */
export function ok(value: unknown, message?: string): asserts value {
  if (!value) {
    throw new Error(message ?? "Expected value to be truthy");
  }
}

export function strictEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
    );
  }
}
