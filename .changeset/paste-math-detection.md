---
"@pretextbook/import": patch
---

Snippet detection now recognizes inline math without TeX commands, such as `Let $P=(1,-1,2)$, $Q=(2,0,-1)$`, so pasting it converts to PreTeXt. Every `$…$` pair is checked, not just the first, and Pandoc's delimiter rules keep prices like `$5 and $7` or `$5-$10` from counting as math.
