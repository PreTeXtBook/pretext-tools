# @pretextbook/typing-shortcuts

## 0.1.0

### Minor Changes

- 1177f49: New package: editor-agnostic PreTeXt typing shortcuts (`$x$` → `<m>x</m>`, `$$x$$` → `<md>x</md>`, escaping a bare `<`/`>`/`&` as `&lt;`/`&gt;`/`&amp;` or `\lt`/`\gt` in math, double Enter or Shift+Enter to start a new paragraph, and `theorem:` + Enter to insert an environment snippet), with a Monaco adapter (`registerMonacoTypingShortcuts`).

### Patch Changes

- Updated dependencies [1177f49]
  - @pretextbook/completions@0.4.0
