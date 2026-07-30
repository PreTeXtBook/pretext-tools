---
"@pretextbook/pretext-html": minor
"pretext-tools": minor
---

Live preview for reveal.js slideshows.

A document whose top-level element is `<slideshow>` now renders as a reveal.js
deck, detected automatically. It opens in reveal's scroll view — the whole deck
as one continuous page, which is what you want while writing — and
**PreTeXt: Live Preview: Toggle Slideshow View** flips to the ordinary
presentation and back without a re-render.

The scroll view is laid out for reading rather than presenting: slides are sized
at reveal's nominal 960×700 and scaled to fit (PreTeXt's published `100%` size
otherwise pins the scale at 1, which is why an unadjusted deck previews
enormously), stacked compactly with an outline around each so slide boundaries
are visible, and `@pause`/`<subslide>` fragments are shown all at once so
scrolling is not interrupted. Switch to the presentation view to step through
the pauses.

The preview toolbar gains a **Deck / Present** switch and a zoom stepper when
the panel is showing a slideshow, so neither is buried in settings. Zooming out
shrinks a deck's text rather than the slide, so more of each slide's content
fits inside it — which is the only way to read content that runs off the bottom
of a slide, since reveal.js clips it. Three new settings back these —
`pretext-tools.instantPreview.slidesView`, `.slidesZoom` and `.slidesTheme` —
controlling which view a preview opens in, how large slide content is drawn,
and which reveal theme decks fall back on (`auto` follows the editor's
light/dark theme, which a deck cannot do on its own).

Slides and sections now carry their PreTeXt `@unique-id` in the rendered deck,
so editor↔preview sync works for slideshows the same way it does for documents.

`@pretextbook/pretext-html` API: `RenderOptions` gains `target`, `revealView`,
`revealTheme` and `revealZoom`; `RenderResult` gains `target`; view control is
published as the dependency-free `@pretextbook/pretext-html/reveal` subpath.
`forcePortablePublication`'s second argument is now an options object
(`{ cssTheme, revealTheme, target }`) rather than a bare `cssTheme` string.
