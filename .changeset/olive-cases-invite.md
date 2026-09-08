---
"@pretextbook/import": patch
---

Pin the internal `@pretextbook/*` dependencies to real ranges instead of `*`. Changesets deliberately leaves a `*` range alone, so published versions of this package never asked npm for a newer `format`, `latex-pretext`, `latex-style-pretext` or `remark-pretext` — any copy already in a consumer's tree satisfied the range and stayed there.
