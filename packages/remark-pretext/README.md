# @pretextbook/remark-pretext

A [remark](https://github.com/remarkjs/remark) plugin that transforms **markdown-style PreTeXt** into a [`@pretextbook/ptxast`](../ptxast) tree.

## What is markdown-style PreTeXt?

Standard Markdown extended with [generic directives](https://github.com/remarkjs/remark-directive) to express PreTeXt-specific environments:

```markdown
## Pythagorean Theorem

A paragraph with inline $math$ and **important** terms.

::::theorem[Pythagorean Theorem]{#thm-pythagoras}
For a right triangle with legs $a$, $b$ and hypotenuse $c$:

$$
a^2 + b^2 = c^2
$$

:::proof
Left as an exercise.
:::
::::
```

## Usage

```ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkDirective from 'remark-directive'
import { remarkPretext } from '@pretextbook/remark-pretext'

const processor = unified()
  .use(remarkParse)
  .use(remarkDirective)   // enables ::: directives
  .use(remarkPretext)

const mdast = processor.parse(markdownString)
const ptxast = processor.runSync(mdast, { value: markdownString }) // PtxRoot

// Serialize to XML (use @pretextbook/ptxast-util-to-xml)
```

> **Note:** Use `.runSync()` (or `.run()`) rather than `.parse()` — `.parse()` only runs the parser phase; transformers (including `remarkPretext`) run during the transform phase.

## Syntax Rules

- `:::name[optional title]{#id attr=val}` opens a block directive
- `:::` alone closes it
- **Nesting**: use one more colon for the outer container when nesting directives:
  - `::::theorem` containing `:::proof` — use `::::` for theorem, `:::` for proof
- All standard PreTeXt block names are recognised (see `DIRECTIVE_MAP`)
- Standard Markdown headings map to divisions:
  - `#` → `<chapter>`
  - `##` → `<section>`
  - `###` → `<subsection>`
  - `####` → `<subsubsection>`
- Inline elements:
  - `*text*` → `<em>`
  - `**text**` → `<alert>` (semantic emphasis in PreTeXt)
  - `` `code` `` → `<c>`
  - `$...$` and `\(...\)` → `<m>`
  - `$$...$$` and `\[...\]` → display math (`<md>`)

## Supported Directives

| Category | Names |
|----------|-------|
| theorem-like | `theorem`, `lemma`, `corollary`, `proposition`, `claim`, `fact`, `conjecture`, `axiom`, `principle`, `hypothesis`, `algorithm` |
| definition-like | `definition`, `notation` |
| remark-like | `remark`, `note`, `observation`, `warning`, `insight`, `assemblage` |
| example-like | `example`, `question`, `problem`, `exercise`, `activity`, `exploration`, `investigation`, `project` |
| proof-like | `proof`, `case` |
| solution-like | `solution`, `hint`, `answer` |
