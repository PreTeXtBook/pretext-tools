# PreTeXt Formatter

A utility to format PreTeXt source.

## Install

```sh
npm install @pretextbook/format
```

## Library usage

```js
import { formatPretext } from "@pretextbook/format";

const formatted = formatPretext(sourceCode);
```

You can pass options to customize formatting:

```js
const options = {
  breakLines: "many",
  breakSentences: true,
  breakLongAttributes: true,
  printWidth: 80,
  insertSpaces: true,
  tabSize: 2,
};

const formatted = formatPretext(sourceCode, options);
```

## CLI usage

The package also exposes a CLI:

```sh
pretext-format [options] [files...]
```

Recommended workflow (inside a project):

```sh
# Install in your project (usually as a dev dependency)
npm install -D @pretextbook/format

# Run the project-local CLI
npx pretext-format --write chapter.ptx
# or
npm exec -- pretext-format --write chapter.ptx
```

One-off run without adding a dependency:

```sh
npm exec --package @pretextbook/format -- pretext-format --check chapter.ptx
```

More examples:

```sh
# Print a formatted file to stdout
npx pretext-format chapter.ptx

# Write formatting changes in-place
npx pretext-format --write chapter.ptx section.ptx

# Check whether files are already formatted (exit 1 if not)
npx pretext-format --check chapter.ptx

# Format stdin and print to stdout
cat chapter.ptx | npx pretext-format --stdin
```

Options:

- `-w, --write` write formatted output back to files
- `--check` check formatting only (no writes)
- `--stdin` read input from stdin
- `--break-lines <few|some|many>` choose line break density
- `--break-sentences` break plain-text sentences onto new lines
- `--break-long-attributes` wrap long block start-tag attributes onto their own lines
- `--tab-size <n>` set spaces per indent level
- `--use-tabs` indent with tabs instead of spaces
- `-h, --help` show help
- `-v, --version` show version

## Building

Run `npm run build -w @pretextbook/format` to build the library.

## Running unit tests

Run `npx vitest --watch` (from this directory) or `npm run test -w @pretextbook/format` (from the root directory) to execute the unit tests via [Vitest](https://vitest.dev/).

## Snapshot tests

Snapshot tests live in `src/lib/format-snapshots.spec.ts`. They read `.ptx` input files from `src/lib/__fixtures__/`, run `formatPretext` on each one, and compare the output against reference files in `src/lib/__snapshots__/`.

**To add a new snapshot test:**

1. Add a `.ptx` input file to `src/lib/__fixtures__/`. The file should contain unformatted (or inconsistently formatted) PreTeXt that exercises the behavior you want to lock in.

2. Register the fixture in `format-snapshots.spec.ts`. For default options, add its base name to the `fixtures` array:
   ```ts
   const fixtures = [
     "minimal-book",
     "my-new-fixture", // add here
     ...
   ] as const;
   ```
   For non-default options, add a dedicated `it` block:
   ```ts
   it("my-new-fixture with tabs", async () => {
     const result = formatPretext(readFixture("my-new-fixture"), {
       insertSpaces: false,
     });
     await expect(result).toMatchFileSnapshot(
       snapshotPath("my-new-fixture-tabs"),
     );
   });
   ```

3. Run once with the update flag to generate the snapshot file:
   ```sh
   npx vitest --update
   ```
   This writes the formatted output to `src/lib/__snapshots__/<name>.ptx`. Review that file to confirm the formatter is behaving as expected, then commit both the fixture and the snapshot.

**To update snapshots** after an intentional formatter change, re-run with `-u` and commit the updated snapshot files.
