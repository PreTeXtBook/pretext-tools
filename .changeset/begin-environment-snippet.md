---
"@pretextbook/latex-style-pretext": minor
---

Typing `\` now offers `\begin{...}` first, which writes the whole environment with the name as a tab stop mirrored into `\end{...}`, lists the environments that can begin there, and moves into the body once one is chosen. Choosing a name from an existing `\begin{...}\end{...}` pair now completes just the name rather than writing a second `\end{...}`.

Environment names now follow the context: inside math they are the math environments (`pmatrix`, `cases`, ...), and in text they include the display math environments (`align`, `equation`, ...).

To get the automatic list and the move into the body, a host must pass each completion item's `command` through to its editor, and `filterText` for matching. Without them the snippet still works, using the usual suggest key and Tab.
