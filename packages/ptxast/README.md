# @pretextbook/ptxast

TypeScript type definitions for the PreTeXt Abstract Syntax Tree (ptxast).

`ptxast` is a strongly-typed AST representation for [PreTeXt](https://pretextbook.org) documents, following the [unist](https://github.com/syntax-tree/unist) / [xast](https://github.com/syntax-tree/xast) ecosystem patterns.

## Design

Each significant PreTeXt element (`<theorem>`, `<section>`, `<p>`, `<m>`, etc.) has its own TypeScript interface with typed `children` and `attributes`, rather than using a generic `Element` with a string `name` field. This gives you IDE autocompletion and compile-time checks across the entire PreTeXt vocabulary.

Node `type` values match PreTeXt XML tag names exactly (`"theorem"`, `"section"`, `"p"`, etc.).

## Usage

```ts
import type { PtxRoot, Section, Theorem, P } from '@pretextbook/ptxast';
import { section, theorem, proof, p, text, m, statement } from '@pretextbook/ptxast';
import { isPtxNode, isTheorem, isSection } from '@pretextbook/ptxast';

// Build a tree with typed factory functions
const tree = section(
  [
    theorem(
      [
        statement([p([text('For a right triangle: '), m('a^2 + b^2 = c^2')])]),
        proof([p([text('Left as an exercise.')])]),
      ],
      { 'xml:id': 'thm-pythagoras' }
    ),
  ],
  { 'xml:id': 'sec-geometry' }
);

// Narrow with type guards
if (isSection(tree)) {
  for (const child of tree.children) {
    if (isTheorem(child)) {
      console.log('Found a theorem:', child.attributes?.['xml:id']);
    }
  }
}
```

## Content Model

| Union | Description |
|-------|-------------|
| `PtxInlineContent` | Text, emphasis, math (`<m>`), cross-refs, code, etc. |
| `PtxBlockContent` | Paragraphs, lists, display math, all environments |
| `PtxDivisionContent` | Chapters, sections, subsections, appendices |
| `PtxContent` | Everything — the full union |

## Building

```sh
nx build ptxast
```

## Testing

```sh
nx test ptxast
```
