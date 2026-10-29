---
"@pretextbook/completions": minor
---

Offer whole-file templates at the document root. In an empty document, or after the XML declaration, the completions now include `<!ptx-article`, `<!ptx-book`, `<!ptx-slideshow` and `<!ptx-part`/`chapter`/`section`/`exercises`/`worksheet`/`handout`, each scaffolding the file with its XML declaration, root element and title; they keep matching while `<!ptx-` is typed. The elements a file may start with are offered there too. `CompletionSchema` gains an optional `rootElements` (the grammar's `<start>`), which the bundled default schema now records; a schema without it treats every element as a possible root.
