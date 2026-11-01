---
"@pretextbook/remark-pretext": minor
"@pretextbook/ptxast-util-to-mdast": minor
---

Headings take attributes the way directives do: `## My Title {#sec-a label="x"}` sets the division's `xml:id` and `label`, instead of leaving the braces in the title. A link to an id is now a cross-reference, so `[](#sec-a)` becomes `<xref ref="sec-a"/>` and `[text](#sec-a)` becomes `<xref ref="sec-a">text</xref>`.

Converting PreTeXt back to Markdown writes both forms too. An `<xref>` that Markdown can't express (`text=`, `first`/`last`, a list of ids) is still dropped.

Inline directives (`:name[...]`) are no longer parsed, since nothing used them, so a colon in prose like `f:X` stays text rather than becoming a `<TODO>`.
