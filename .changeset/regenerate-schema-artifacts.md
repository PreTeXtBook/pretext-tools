---
"@pretextbook/completions": patch
"@pretextbook/format": patch
"@pretextbook/ptxast": patch
"@pretextbook/schema": patch
---

Regenerate schema artifacts from the updated `pretext.rng`, which added
bibliography fields such as `archive_location`, `chapter-number`,
`collection-number`, `container-title-short`, `number-of-volumes` and `version`.
The formatter keeps the new text-only fields on one line with their tags.
