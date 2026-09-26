---
"@pretextbook/pretext-html": minor
---

Add `patchDocument`, `typesetPatch` and `livePatchScript` (also published as
the dependency-free `@pretextbook/pretext-html/live-patch` subpath) for
updating a preview that is already on screen in place.

Replacing a rendered page on every re-render blanks it, re-runs its scripts
and has MathJax typeset the whole document again, so the preview flashes and
loses its scroll position. `patchDocument` instead diffs the previous render
against the new one and changes only what differs in the live page: identical
blocks are left alone (typeset math, opened proofs and Runestone state
survive), blocks whose auto-generated ids merely shifted are updated in place,
and changed blocks are replaced. `typesetPatch` then has MathJax typeset just
the replaced blocks.

It declines — leaving the page untouched, so the caller can fall back to
replacing it — when something changed that only works on a fresh load: the
page head, a script, a Runestone exercise, or the LaTeX macros.
`livePatchScript` serializes both functions into an inline script for
embedders whose page runs in a separate context, such as a VS Code webview.
