---
"@pretextbook/format": patch
---

Stop the formatter from changing document content:

- Preserve whitespace at inline element boundaries: no space is added where the source has none (`(<m>x</m>)`, `<m>x</m>'s`, `a<mdash/>b`), and none is removed before a spaced hyphen (`<m>x</m> - y`). Closing brackets after display math stay on the closing tag's line.
- Keep processing instructions (including `<?xml-model?>` after the XML declaration) and CDATA sections, which were deleted in several positions. Processing instructions between blocks are now indented.
- Keep consecutive top-level comments on their own lines instead of merging them.
- Flow text mixed with markup as prose in elements with no dedicated layout, such as a raw `<biblio>`, `<intertext>`, and `<feedback>`, rather than splitting it at every tag. Files laid out that way by earlier versions are repaired.
