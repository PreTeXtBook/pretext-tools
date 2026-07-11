# @pretextbook/schema

RELAX NG validation and context-aware completions for [PreTeXt](https://pretextbook.org)
documents, built on the [`salve-annos`](https://www.npmjs.com/package/salve-annos)
engine.

This package powers the diagnostics and (as a fallback) the completions in the
PreTeXt Tools VS Code extension's language server, but it has no dependency on
VS Code and can be used standalone.

## What it does

- **Validation** — checks a document against the compiled PreTeXt grammar and
  returns LSP-shaped `Diagnostic`s with precise ranges. Errors are recovered, so
  a single pass reports every problem, not just the first.
- **XInclude awareness** — resolves `xi:include` references before validating and
  maps errors in an included file back to the file and line they came from.
- **Completions** — uses salve's `walker.possible()` to offer exactly the
  elements/attributes allowed at the cursor, respecting the content model.
- **Customizable rules** — a small rule layer lets you override severities,
  rewrite messages, tag diagnostics with stable ids, or suppress them.

## Usage

```ts
import {
  loadGrammarFromJSON,
  validateDocument,
  getCompletions,
} from '@pretextbook/schema';
import fs from 'fs';

// Load the precompiled grammar (generated at build time — see below).
const grammar = loadGrammarFromJSON(
  fs.readFileSync('assets/pretext.json', 'utf8'),
);

const result = validateDocument(source, grammar, {
  uri: 'file:///book/main.ptx',
});
for (const [uri, diagnostics] of Object.entries(result.diagnosticsByUri)) {
  // publish `diagnostics` for `uri`
}

const items = getCompletions({ text: source, position, grammar });
```

### Compiling a grammar

`loadGrammarFromJSON` is the fast runtime path. To produce that JSON from a
`.rng` file (e.g. after the upstream schema changes), use the build-time entry
point, which pulls in salve's Node-only conversion machinery:

```ts
import { compileRngToJSON } from '@pretextbook/schema/compile';
const { json, warnings } = await compileRngToJSON('schema/pretext.rng');
```

The monorepo wires this up via `scripts/compile-grammar.mjs`, run as part of
`npm run refresh:schemas` and the extension build. It writes `pretext.json`
alongside the `.rng` files the extension ships.

## Custom rules

```ts
import { validateDocument, Severity } from '@pretextbook/schema';

const result = validateDocument(source, grammar, {
  ruleset: {
    defaultSeverity: Severity.Error,
    rules: [
      {
        id: 'text-not-allowed',
        match: (e) => e.kind === 'text-not-allowed',
        severity: Severity.Warning,
      },
    ],
  },
});
```

Each raw error is normalized to a `SchemaError` (`kind`, `name`, `alternatives`,
`range`, `uri`); the first matching rule decides its severity, message, and
whether it is suppressed.

## Notes

- The engine is `salve-annos`, a maintained fork of `salve` that fixes the
  Windows `file://` handling and tracks modern Node/TypeScript.
- The experimental schema (`pretext-dev.rng`) currently has dangling refs
  upstream and may fail to compile; the build treats that as non-fatal and falls
  back to the stable grammar.
