# PreTeXt Formatter

A utility to format PreTeXt source. To use,

```
npm install @pretextbook/format
```

and then import the formatter in your code:

```javascript
import { format } from "@pretextbook/format";

const formatted = formatPretext(sourceCode);
```

You can pass options as an object to customize the formatting. For example:

```javascript
const options = {
  breakLines: "many",
  breakSentences: true,
  insertSpaces: true,
  tabSize: 2,
};

const formatted = formatPretext(sourceCode, options);
```

This allows you to specify the maximum line length and indentation level for the formatted output.

## Building

Run `nx build format` to build the library.

## Running unit tests

Run `nx test format` to execute the unit tests via [Vitest](https://vitest.dev/).

## About

This library was generated with [Nx](https://nx.dev).
