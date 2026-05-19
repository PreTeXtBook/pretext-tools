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

Examples:

```sh
# Print a formatted file to stdout
pretext-format chapter.ptx

# Write formatting changes in-place
pretext-format --write chapter.ptx section.ptx

# Check whether files are already formatted (exit 1 if not)
pretext-format --check chapter.ptx

# Format stdin and print to stdout
cat chapter.ptx | pretext-format --stdin
```

Options:

- `-w, --write` write formatted output back to files
- `--check` check formatting only (no writes)
- `--stdin` read input from stdin
- `--break-lines <few|some|many>` choose line break density
- `--break-sentences` break plain-text sentences onto new lines
- `--tab-size <n>` set spaces per indent level
- `--use-tabs` indent with tabs instead of spaces
- `-h, --help` show help
- `-v, --version` show version

## Building

Run `npm run build -w @pretextbook/format` to build the library.

## Running unit tests

Run `npm run test -w @pretextbook/format` to execute the unit tests via [Vitest](https://vitest.dev/).
