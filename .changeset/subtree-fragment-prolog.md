---
"@pretextbook/pretext-html": patch
---

Fix `subtree` selection for a fragment rendered in its context document: a line before the fragment's root element (its XML declaration, where a freshly opened file puts the cursor) selected the whole book instead of the fragment's own division.
