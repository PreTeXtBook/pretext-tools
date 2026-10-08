---
"@pretextbook/import": minor
---

Paste conversion no longer converts where it shouldn't.

`pasteTargetAt(prefix)` takes the document text up to the cursor and reports
whether converted markup belongs there — not inside math, verbatim content
(`<latex-image>`, `<program>`, `<code>`, `<macros>`, `<prefigure>`, …), a
comment, a tag or attribute value, or an element the schema gives no markup —
and whether the cursor is in running text. Its `inline` follows the schema, so
a paste into a `<title>` or `<caption>` is placed inline rather than wrapped in
a `<p>`; pass it as `PlacementContext.inline`. Hosts should check
`literal` before `detectSnippetFormat` and paste plainly when it is set.

`detectSnippetFormat` now declines a snippet with XML markup anywhere in it
(an end tag, a self-closing tag, a start tag with an attribute, a comment), not
only one that starts with `<`, so `This is math: <m>\frac{1}{2}</m>.` stays as
it is. The check is exported as `containsXmlMarkup`.
