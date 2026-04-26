# @pretextbook/ptxast-util-to-mdast

Convert [ptxast](../ptxast) (PreTeXt AST) to [mdast](https://github.com/syntax-tree/mdast) (Markdown AST) and Markdown strings. Part of the [pretext-tools](https://github.com/pretextbook/pretext-tools) unified.js ecosystem.

## Install

```sh
npm install @pretextbook/ptxast-util-to-mdast
```

## Use

```ts
import { ptxastToMdast, ptxastToMarkdown } from '@pretextbook/ptxast-util-to-mdast';

// Convert a ptxast root to mdast
const mdast = ptxastToMdast(ptxRoot);

// Or convert directly to a markdown string
const markdown = ptxastToMarkdown(ptxRoot);
```

## API

### `ptxastToMdast(root: PtxRoot): Root`

Converts a `PtxRoot` tree to an mdast `Root` tree with directive nodes for PreTeXt block environments.

### `ptxastToMarkdown(root: PtxRoot): string`

Converts a `PtxRoot` tree to a Markdown string. Theorem-like environments render as `:::theorem` directive fences; divisions render as ATX headings (`##`).

## License

GPL-3.0-or-later
