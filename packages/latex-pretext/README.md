# latex-pretext

This package provides a simple wrapper around `@unified-latex/unified-latex-to-pretext` to convert LaTeX to PreTeXt. It is used by the VSCode extension, but can also be used in other contexts.

## Building

Run `nx build latex-pretext` to build the library.

## Running unit tests

Run `nx test latex-pretext` to execute the unit tests via [Vitest](https://vitest.dev/).

## Development playground

From `packages/latex-pretext`, run `npm run dev` to open a local page with a LaTeX input pane and live PreTeXt output pane.

From the workspace root, you can still run `nx run @pretextbook/latex-pretext:playground`.

If you want a static build of the playground, run `nx run @pretextbook/latex-pretext:playground:build`.
