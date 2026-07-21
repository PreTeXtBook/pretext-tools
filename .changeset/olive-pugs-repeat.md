---
"@pretextbook/pretext-html": patch
---

Fix corruption when renders overlap, and stop misreporting it as a size limit.

`renderHtml` was not reentrant: it drives a single cached compiled stylesheet
through a patched `globalThis.fetch` and shared mount tables, and it suspends
mid-transform to fetch stylesheets — exactly the window in which a second
render could run. Overlapping renders interleaved inside libxslt and corrupted
it. `renderHtml` now queues concurrent calls; each still resolves with its own
result, and a rejected render does not stall the queue.

The failure was very hard to diagnose from its symptoms, so the error mapping
changed too. A collision surfaces as an out-of-bounds memory fault, which was
reported as "the document is too large … (stack overflow)" regardless of the
document's actual size — sending people off to measure documents that were
often only a few hundred bytes. That message now names both possible causes
rather than asserting the less likely one. And because the WASM instance is
terminally aborted after such a fault, every later call failed with an
unrelated pthread mutex assertion; that state is now detected and reported as
what it is, with the instruction to restart the process or reload the page.

Callers driving a UI were the most exposed: React's StrictMode double invokes
mount effects, so a preview component rendering on mount reliably poisoned the
renderer on the very first paint.
