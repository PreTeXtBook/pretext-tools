---
"@pretextbook/latex-pretext": minor
"@pretextbook/import": minor
---

Improve beamer slide imports: the title frame becomes the slideshow's `<frontmatter>` title slide (title, subtitle, every author with their institute, date), `\pause` and incremental lists become PreTeXt pauses, beamer overlay specifications are no longer mangled into `\lt`/`\gt`, and outline frames are dropped instead of left as empty slides. `latexToPretext` gains a `fragment: false` option that returns a whole document.
