---
"@pretextbook/latex-pretext": patch
---

Fix LaTeX files with Windows (CRLF) line endings: each single line break was read as a paragraph break, so every line of a paragraph became its own `<p>`.
