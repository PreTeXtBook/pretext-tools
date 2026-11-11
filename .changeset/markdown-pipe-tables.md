---
"@pretextbook/remark-pretext": minor
"@pretextbook/ptxast-util-to-mdast": minor
"@pretextbook/markdown-style-pretext": minor
---

Markdown-style PreTeXt now has tables. A GFM pipe table converts to a `<tabular>` (header row → `<row header="yes">`, column alignment → `halign` on the `<tabular>` or its `<col>`s), and `:::table[Title]{#id}` around one gives a titled `<table>`. Going back to Markdown, a `<tabular>` becomes a pipe table when nothing would be lost, and is kept as raw PreTeXt otherwise (borders, widths, `colspan`, block content in cells); a `<table>` becomes `:::table`. Editor support completes `:::table` with a title and table skeleton and accepts it in lint. Only the table extension of GFM is enabled.
