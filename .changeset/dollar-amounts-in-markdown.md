---
"@pretextbook/remark-pretext": patch
---

Stop treating dollar amounts as math. `$...$` is now math only when it closes on the same line, has no space just inside its delimiters, and isn't attached to a letter or digit on the outside, so `$2 to $5`, `$5-$10` and a `$` in a URL stay text, and `\$` is always a literal dollar sign. Text between two dollar signs is no longer lost, even across paragraphs. `$$...$$`, `\(...\)` and `\[...\]` are unchanged.

Math written against a word (`the $n$th term`, `90$^\circ$`), padded with spaces (`$ x $`), or wrapped onto a second line now stays text.
