---
"@pretextbook/remark-pretext": minor
---

Raw PreTeXt in Markdown now converts to real elements instead of `<TODO>` placeholders. Tags in running text (`<xref ref="a"/>`, `<url href="...">text</url>`, `<fn>...</fn>`) keep Markdown working between them, while a block (`<figure>`, `<program>`) stays PreTeXt through to its closing tag, even past blank lines. Comments are dropped. Tags that don't balance, don't parse, or aren't PreTeXt (`<br>`, `<div>`) are still flagged with a `<TODO>`.

Math now works everywhere inline content does: headings, emphasis, and link text no longer leak a `PTX_MATH_TOKEN` placeholder, and neither does `$$x$$2`. Display math where it isn't allowed (titles, emphasis, link text) becomes `<m>`. A `$` in a directive attribute or a `~~~` block stays as written.

Frontmatter `title:` and the `topLevelTitle` option are now read as inline Markdown, so they support math, emphasis, code and raw tags like any other title. `1. Intro` stays a plain title.
