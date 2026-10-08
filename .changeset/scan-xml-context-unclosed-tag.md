---
"@pretextbook/typing-shortcuts": minor
---

Export `MATH_ELEMENTS`, the elements whose content is LaTeX math.

`scanXmlContext` now reports an offset as inside a tag when the tag is still
unclosed where the source ends, rather than as in text after it — which matters
when the source is only the text up to the cursor.
