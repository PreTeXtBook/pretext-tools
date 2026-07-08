# Testing Guide

This monorepo has test suites across multiple packages. This guide covers the **VS Code extension** tests in detail, plus a quick reference for other packages.

## VS Code Extension Testing (`pretext-tools`)

The extension has a two-layer test architecture: fast unit tests (Node-only) and slower integration tests (real VS Code instance).

### Unit Tests (Vitest)

Fast tests for logic that does **not** import the `vscode` module. Run in plain Node.

```bash
npm run test:unit -w pretext-tools     # Run all unit tests
npx vitest run --help                  # Other Vitest options
```

**Files**: `src/**/*.spec.ts` (excludes `src/test/`)

**Coverage**: 41 passing tests across:
- **Parse utilities** (`src/parse/utils.spec.ts`) — LSP position math, coordinate conversions
- **LSP helpers** (`src/lsp-server/*.spec.ts`) — validation filters, project-file detection
- **Completions** (`src/lsp-server/completions/utils.spec.ts`) — tag detection, publication files
- **Pure logic** (`src/*.spec.ts`) — project manifest parsing, spell-check patterns, document outline parsing

### Integration Tests (Mocha + VS Code)

Real tests that launch VS Code, activate the extension, and verify end-to-end behavior.

```bash
npm run test:integration -w pretext-tools   # Requires a display (X11 or similar)
# In CI (headless):
xvfb-run -a npm run test:integration -w pretext-tools
```

**Files**: `src/test/suite/**/*.test.ts`

**Coverage**: 4 passing tests:
- Extension activation when a `project.ptx` is present
- `.ptx` files are recognized as the `pretext` language
- **Every command declared in `package.json`** has a registered handler (catches manifest/code drift)
- Allowlist mechanism for intentionally unimplemented commands (e.g., `pretext-tools.spellCheck`)

**Important**: Integration tests run the **bundled extension** at `dist/vscode-extension/`, not your `src/` files. The `pretest:integration` script handles building and copying assets; just run `npm run test:integration`.

### Running Both from Root

```bash
npm test   # Runs all package tests, including extension unit tests
```

This does NOT run integration tests (which need a display). See [CI](#ci) for the full suite.

## Other Packages

Quick reference for other test suites:

```bash
npm run test -w @pretextbook/completions    # Vitest
npm run test -w prettier-plugin-pretext     # Vitest  
npm run test -w @pretextbook/schema         # Vitest
npm run test:reliability                    # Conversion reliability matrix (remark-pretext, etc.)
```

## CI/CD Setup

The GitHub Actions workflow (`.github/workflows/pull-request-tests.yml`) automatically runs on every PR and push to main:

### Jobs and Timeouts

| Job | Timeout | What it does |
|---|---|---|
| **checks** | 30m | Formatting (Prettier), schema artifacts, utility builds, reliability matrix |
| **vscode-extension-unit** | 15m | Vitest unit tests (41 tests across 7 files) |
| **vscode-extension-integration** | 20m | VS Code instance tests with `xvfb-run` (4 tests) |
| **test-results** | — | Depends on all three above; reports unified pass/fail status |

### Key Features

- **Concurrency control**: Pushes to the same branch cancel previous runs (avoids redundant CI on force-push)
- **Clear PR checks**: The `test-results` job provides a single pass/fail signal visible in PR UI — drill down into individual job logs for details
- **Timeouts**: Prevents hanging on slow network or system load (VS Code download can take a while on first run)
- **Headless display**: Integration tests use `xvfb-run -a` for a virtual X display (no GUI available in CI)

### Example PR Check Status

When you push to a PR, GitHub shows:
- ✅ checks (formatting + reliability)
- ✅ vscode-extension-unit (41 tests)
- ✅ vscode-extension-integration (4 tests)
- ✅ test-results (summary)

If any fail, the PR is blocked until fixed.

### Local Pre-Push Checks

Before pushing, run locally to catch issues early:
```bash
npm run lint                           # Format + linting
npm run test:unit -w pretext-tools     # Unit tests (fast)
npm run test:integration -w pretext-tools  # Integration tests (slow, needs display)
```

## Common Issues

### "Extension command X is not registered"
The integration test `commands.test.ts` failed. This usually means:
- A command was declared in `package.json` `contributes.commands` but the handler wasn't registered in `extension.ts`
- Or: a handler was registered with the wrong ID (e.g., `formatPretextDocument` instead of `format`)

**Fix**: Check that the `command:` ID in the manifest matches the `registerCommand(...)` call in `extension.ts`.

### Integration tests show stale behavior
Integration tests run the **bundled** extension at `dist/vscode-extension/`. If you changed source files, rebuild:
```bash
npm run esbuild && npm run copy-assets
# or just:
npm run test:integration -w pretext-tools   # includes pretest:integration, which does this
```

### "Cannot find module @pretextbook/schema"
Unit tests import `@pretextbook/schema`, which must be built first:
```bash
npm run build:deps   # Builds @pretextbook/ptxast, remark-pretext, schema, etc.
npm run test:unit -w pretext-tools
```

## Implementation Notes

The extension's testability was improved by:
1. **Extracting pure logic** into separate modules (`outline-parser.ts`, `project-manifest.ts`, `pure-utils.ts`, `lsp-server/paths.ts`) so it can be tested without the `vscode` API
2. **Deferring import-time side effects** (`connection.ts` lazy-imports inside async functions)
3. **A fixture project** at `src/test/fixtures/sample-project/` with `project.ptx` and sample source files

## See Also

- [Extension CLAUDE.md](../packages/vscode-extension/CLAUDE.md) — architecture & development notes
- [PR #XXX](TBD) — initial test implementation
