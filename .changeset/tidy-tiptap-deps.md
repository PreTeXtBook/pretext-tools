---
"@pretextbook/visual-editor": patch
---

Update TipTap to 3.35 and declare the `@tiptap/core`, `@tiptap/extension-hard-break`, and `@tiptap/extension-text` dependencies the editor imports directly (previously they only resolved through hoisting).
