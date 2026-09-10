---
"@pretextbook/import": minor
"pretext-tools": patch
---

Wrap pasted text in `<p>` when it lands outside a paragraph.

`unified-latex` wraps paragraphs only when the LaTeX it is given has more than one of them, so the commonest paste there is — a single paragraph of prose — arrived as bare text with no `<p>` around it, and `Intro \begin{theorem}…\end{theorem} outro` arrived as text on either side of a block with no paragraph around either. Both are invalid wherever the cursor is not already inside a `<p>`.

`placeConvertedMarkup` now supplies the missing paragraphs on the block-context path, and the new `wrapLooseParagraphs` export does it for hosts that want the pass on its own. It follows the schema's rule rather than a hand-written list of tags: a top-level element the `<p>` content model admits joins the paragraph being accumulated — `<m>` and `<em>`, and equally `<md>` and `<ol>`, which belong inside a paragraph — while one it does not, such as `<theorem>`, `<pre>`, or a division, ends the run and passes through untouched. Markup that already has its paragraphs is unchanged.

Two fixes on the inline path, where the insertion point is inside a `<p>`. Unwrapping the converter's own `<p>` used a regex that would "unwrap" `<p>A</p><p>B</p>` into `A</p><p>B`; several paragraphs are now left intact with a warning instead. And the warning about content that cannot sit inside a paragraph covers every block element rather than only divisions, so a pasted `<theorem>` or `<pre>` is reported too — while a nested `<p>`, inside an `<li>` of a legal `<ol>`, no longer trips it.
