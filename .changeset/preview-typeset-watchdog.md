---
"@pretextbook/pretext-html": minor
---

Live preview fixes for hosts that patch pages in place.

- `typesetPatch` no longer waits forever on a MathJax whose startup never settles (MathJax 4 does this, without failing, when a Content-Security-Policy blocks its `blob:` speech worker). It takes a `timeoutMs` (default 5000): once that runs out the patched blocks are typeset anyway, and the stuck promise is dropped from the queue. It now resolves a boolean, `false` meaning the math is still untypeset and the page should be replaced. A host with a Content-Security-Policy needs `worker-src blob: https:`.
- Previews no longer build a search index or show a search box: the publication file is forced to `<html><search variant="none"/>`. The index was rebuilt from the whole document on every render, and the non-portable build asked for it as a file that does not exist.
- An error for an `xi:include`d file that is not well-formed now carries the parser's error as `cause` (with its `line` and `column`) and the included file as `file`.
