---
"@pretextbook/latex-pretext": minor
"@pretextbook/import": minor
"@pretextbook/latex-style-pretext": patch
---

Improve beamer slide imports: the title frame becomes the slideshow's `<frontmatter>` title slide (title, subtitle, every author with their institute, date), `\pause` and incremental lists become PreTeXt pauses, beamer overlay specifications are no longer mangled into `\lt`/`\gt`, and outline frames are dropped instead of left as empty slides. `latexToPretext` gains a `fragment: false` option that returns a whole document. The LaTeX macro table now knows beamer's `\institute`, `\inst`, `\titlegraphic`, `\titlepage` and `\note`, and reads an overlay spec such as `\alert<2>{...}` as an optional argument.
