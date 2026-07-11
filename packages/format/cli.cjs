#!/usr/bin/env node

const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { formatPretext } = require('./index.cjs');

function printHelp() {
  process.stdout.write(`Usage: pretext-format [options] [files...]

Format PreTeXt files or stdin.

Options:
  -w, --write                Write formatted output back to files
      --check                Check formatting without writing changes
      --stdin                Read input from stdin
      --break-lines <mode>   Line break mode: few | some | many
      --break-sentences      Break plain-text sentences onto new lines
      --break-long-attributes Wrap long block start-tag attributes onto their own lines
      --tab-size <n>         Number of spaces per indent level
      --use-tabs             Indent with tabs instead of spaces
  -h, --help                 Show this help
  -v, --version              Show package version
`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseCli() {
  try {
    return parseArgs({
      options: {
        write: { type: 'boolean', short: 'w', default: false },
        check: { type: 'boolean', default: false },
        stdin: { type: 'boolean', default: false },
        'break-lines': { type: 'string' },
        'break-sentences': { type: 'boolean', default: false },
        'break-long-attributes': { type: 'boolean', default: false },
        'tab-size': { type: 'string' },
        'use-tabs': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    fail(error.message);
  }
}

function parseOptions(values) {
  /** @type {{breakLines?: "few" | "some" | "many"; breakSentences?: boolean; breakLongAttributes?: boolean; insertSpaces?: boolean; tabSize?: number}} */
  const formatOptions = {};
  if (values['break-lines'] !== undefined) {
    if (!['few', 'some', 'many'].includes(values['break-lines'])) {
      fail(`--break-lines must be one of: few, some, many`);
    }
    formatOptions.breakLines = values['break-lines'];
  }
  if (values['break-sentences']) {
    formatOptions.breakSentences = true;
  }
  if (values['break-long-attributes']) {
    formatOptions.breakLongAttributes = true;
  }
  if (values['use-tabs']) {
    formatOptions.insertSpaces = false;
  }
  if (values['tab-size'] !== undefined) {
    const tabSize = Number.parseInt(values['tab-size'], 10);
    if (!Number.isInteger(tabSize) || tabSize <= 0) {
      fail(`--tab-size must be a positive integer`);
    }
    formatOptions.tabSize = tabSize;
  }
  return formatOptions;
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`Could not read ${filePath}: ${error.message}`);
  }
}

function writeFile(filePath, text) {
  try {
    fs.writeFileSync(filePath, text, 'utf8');
  } catch (error) {
    fail(`Could not write ${filePath}: ${error.message}`);
  }
}

function main() {
  const { values, positionals } = parseCli();

  if (values.help) {
    printHelp();
    return;
  }
  if (values.version) {
    process.stdout.write(`${require('./package.json').version}\n`);
    return;
  }

  if (values.stdin && positionals.length > 0) {
    fail(`--stdin cannot be combined with file arguments`);
  }
  if (values.stdin && values.write) {
    fail(`--write cannot be used with --stdin`);
  }
  if (values.stdin === false && positionals.length === 0) {
    fail(`Provide files or use --stdin`);
  }
  if (positionals.length > 1 && !values.write && !values.check) {
    fail(`Multiple files require --write or --check`);
  }

  const formatOptions = parseOptions(values);

  if (values.stdin) {
    const input = fs.readFileSync(0, 'utf8');
    const formatted = formatPretext(input, formatOptions);
    if (values.check) {
      if (formatted !== input) {
        process.stderr.write('stdin is not formatted\n');
        process.exit(1);
      }
      return;
    }
    process.stdout.write(formatted);
    return;
  }

  let hasUnformatted = false;
  for (const filePath of positionals) {
    const input = readFile(filePath);
    const formatted = formatPretext(input, formatOptions);
    if (values.check) {
      if (formatted !== input) {
        hasUnformatted = true;
        process.stderr.write(`${filePath}\n`);
      }
      continue;
    }
    if (values.write) {
      if (formatted !== input) {
        writeFile(filePath, formatted);
      }
      continue;
    }
    process.stdout.write(formatted);
  }

  if (values.check && hasUnformatted) {
    process.exit(1);
  }
}

main();
