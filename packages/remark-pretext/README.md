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
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import { remarkPretext } from "@pretextbook/remark-pretext";

const processor = unified()
  .use(remarkParse)
  .use(remarkDirective) // enables ::: directives
  .use(remarkPretext);

const mdast = processor.parse(markdownString);
const ptxast = processor.runSync(mdast, { value: markdownString }); // PtxRoot

// Serialize to XML (use @pretextbook/ptxast-util-to-xml)
```

> **Note:** Use `.runSync()` (or `.run()`) rather than `.parse()` — `.parse()` only runs the parser phase; transformers (including `remarkPretext`) run during the transform phase.

## Headings and the top-level division

Headings map to divisions **relative to a configurable top-level division
type** — `#` always means "the title of this document's top-level division",
and each additional `#` moves one level down the hierarchy:

```
part → chapter → section → subsection → subsubsection → paragraphs
```

(`book`/`article` aren't included — they're document roots, never chosen via
heading depth.) By default the top-level division is `chapter` (`#` →
`<chapter>`, `##` → `<section>`, etc.), matching historical behavior.

There are two ways to change it:

1. **Frontmatter** — add a `division:` field to a leading YAML-style block,
   useful for a standalone markdown document that wants to describe its own
   structure:

   ```markdown
   ---
   division: section
   ---

   # Top-level section

   ## A subsection
   ```

2. **Explicit option** — pass `topLevelDivision` to `remarkPretext` or
   `markdownToPretext` when the caller already knows the context. This takes
   precedence over frontmatter when both are present.

   ```ts
   import { markdownToPretext } from "@pretextbook/remark-pretext";

   markdownToPretext("# Title\n\n## Sub", { topLevelDivision: "section" });
   // → '<section><title>Title</title><subsection>...'
   ```

### Title from frontmatter

By default (no `title:` field), `#` supplies the top-level division's own
title, as shown above. Adding a `title:` field to the frontmatter moves the
title there instead — `#` then starts the top-level division's **first
subdivision**, and every heading resolves one level deeper than usual:

```markdown
---
division: section
title: Limits
---

Some introductory text.

# Part A

A `<subsection>` titled "Part A".
```

```xml
<section>
  <title>Limits</title>
  <introduction>
    <p>Some introductory text.</p>
  </introduction>
  <subsection>
    <title>Part A</title>
    ...
  </subsection>
</section>
```

When `division:` names a document root (`book`/`article`/`slideshow`),
`title:` sets the root element's own `<title>` instead, and `#` keeps its
existing meaning (the root's outermost child division — unaffected by this
field, since it was already one level below the root).

Pass `topLevelTitle` to `remarkPretext` or `markdownToPretext` to set this
explicitly instead; like `topLevelDivision`, it overrides frontmatter when
both are present.

### Section-like divisions

`division:` also accepts a set of section-like types that don't belong to
the part/chapter/.../paragraphs hierarchy: `worksheet`, `exercises`,
`references`, `appendix`, `glossary`, `handout`, `solutions`,
`reading-questions`, `introduction`, and `conclusion`.

`appendix` nests like `chapter` (deeper headings become `section`,
`subsection`, etc.), since the PreTeXt schema allows nested sections inside
an appendix. The rest don't support nested sections, so any heading deeper
than the top-level one becomes a `<paragraphs>` division instead:

```markdown
---
division: worksheet
---

# Worksheet on Limits

## Part A

A `<paragraphs>` division, titled "Part A".
```

### Attributes from frontmatter

`xmlid:`, `label:`, and `component:` frontmatter fields become `xml:id`,
`label`, and `component` attributes on the document's first top-level
division:

```markdown
---
division: section
xmlid: limits-intro
label: sec-limits-intro
component: limits
---

# Introduction to Limits
```

```xml
<section xml:id="limits-intro" label="sec-limits-intro" component="limits">
  <title>Introduction to Limits</title>
  ...
</section>
```

Pass `topLevelAttributes` to `remarkPretext` or `markdownToPretext` to set
these explicitly instead; like `topLevelDivision`, it overrides frontmatter
when both are present.

## Syntax Rules

- `:::name[optional title]{#id attr=val}` opens a block directive
- `:::` alone closes it
- **Nesting**: use one more colon for the outer container when nesting directives:
  - `::::theorem` containing `:::proof` — use `::::` for theorem, `:::` for proof
- All standard PreTeXt block names are recognised (see `DIRECTIVE_MAP`)
- Inline elements:
  - `*text*` → `<em>`
  - `**text**` → `<alert>` (semantic emphasis in PreTeXt)
  - `` `code` `` → `<c>`
  - `$...$` and `\(...\)` → `<m>`
  - `$$...$$` and `\[...\]` → display math (`<md>`)

## Supported Directives

| Category        | Names                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| theorem-like    | `theorem`, `lemma`, `corollary`, `proposition`, `claim`, `fact`, `conjecture`, `axiom`, `principle`, `hypothesis`, `algorithm` |
| definition-like | `definition`, `notation`                                                                                                       |
| remark-like     | `remark`, `note`, `observation`, `warning`, `insight`, `assemblage`                                                            |
| example-like    | `example`, `question`, `problem`, `exercise`, `activity`, `exploration`, `investigation`, `project`                            |
| proof-like      | `proof`, `case`                                                                                                                |
| solution-like   | `solution`, `hint`, `answer`                                                                                                   |
