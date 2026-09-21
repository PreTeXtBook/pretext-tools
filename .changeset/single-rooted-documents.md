---
"@pretextbook/import": patch
---

Report a source that is not a single-rooted PreTeXt document instead of
guessing its root.

`findRootElement` locates the root at depth 0 inside `<pretext>`, while
`detectDocumentKind` scans at any depth and answers `slideshow` first. The two
disagreed on a document carrying more than one root: an `<article>` with a
`<slideshow>` nested inside it imported as a project marked `slideshow` whose
source said `<article>`, and two roots side by side silently resolved to
whichever came first in `PRETEXT_ROOT_TAGS` rather than in the document.

`pretext.rng` admits exactly one root — the `<pretext>` content model is a bare
`<choice>` — and references a root element from no content model at all, so
neither shape can be read as a document. `findRootElement` now throws for both,
which `importProjectFromFiles` already surfaces as a `pretextError` with an
`error` status message. Roots quoted inside comments or CDATA are unaffected: a
document _about_ PreTeXt still imports.
