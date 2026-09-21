---
"@pretextbook/import": patch
---

Keep a slideshow's root element through the import.

`detectDocumentKind` recognised a deck, but every stage that had to locate a
root element looked for `<book>` or `<article>` only. A `<slideshow>` matched
neither, so the pool builder wrapped it in an `<article xml:id="document">`
that survived into `outputFiles` and into the division pool, and the LaTeX
projection opened with `\article{}` — losing the deck's title and `xml:id`
along with its root.

The root tags now come from `PRETEXT_ROOT_TAGS` via a shared `findRootElement`,
which the pool builder, the division outline/prune and the insert preparation
all share rather than each spelling out the tags.
