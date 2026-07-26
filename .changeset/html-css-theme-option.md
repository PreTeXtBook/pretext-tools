---
"@pretextbook/pretext-html": minor
---

Add a `cssTheme` render option (`--css-theme` on the CLI) that supplies the
PreTeXt HTML theme via `<html><css theme="…"/></html>` in the publication file
used for the build. It applies only when the project's own publication file
names no theme, so a book that has chosen one still previews in it.
