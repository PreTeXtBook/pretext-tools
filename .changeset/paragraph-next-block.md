---
"@pretextbook/typing-shortcuts": minor
---

One more Enter (or Shift+Enter) in the empty `<p>` a paragraph split leaves now moves on: in a list item it starts the next `<li><p></p></li>`, in an empty last item it leaves the list (landing in the paragraph that holds it), and at the end of a `<statement>`, `<proof>`, or other non-division block it steps outside the block. A double Enter or Shift+Enter in any empty `<p>` does the same, and `nextBlockEdit` is exported. Hosts that skip the change event of a shortcut's own edit should now call the new `editApplied(edit)` instead of `reset()`, so the Enter after a paragraph edit still moves on; the Monaco adapter does this.
