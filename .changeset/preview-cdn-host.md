---
"@pretextbook/pretext-html": minor
---

Build previews with PreTeXt's CDN resource host instead of portable HTML, so latex-image and PreFigure SVGs are linked rather than inlined.

- The preview publication now forces `<html><resources host="cdn"/>`, `<common><chunking level="0"/>`, `<html><cross-references knowled="never"/>` and `<html><platform portable="no"/>`. The page is otherwise the same as before: one page, CDN css/js, cross-references as links, and the search index embedded. The difference is that generated SVGs are `<img src="generated/latex-image/…">` links, which a host retargets with `rewriteAssetUrls` like every other asset. Nothing reads image files during the render any more, which is what a browser host without a filesystem needs.
- `RenderResult.assetDirs` follows PreTeXt's current rules and is always present. `external` comes from the document's `<docinfo><directories external="…"/>` first and the publication file second, and is absent when neither declares it. `generated` defaults to `generated/` beside the main source. Projects that declare external in the docinfo and generated in the publication file, as PreTeXt's own samples now do, previously got no `assetDirs` at all.
- Breaking: `assetDirs.external` is now optional, and `AssetDirectories.managed` is gone, since managed directories are PreTeXt's only scheme. `readAssetDirectories()` takes the docinfo's `@external` as a second argument, and the new `docinfoExternalDirectory()` reads it from a document.
- `forcePortablePublication` is renamed `forcePreviewPublication`. The old name remains as a deprecated alias.
- Hosts should version each asset URL (a modification-time query, say), because a page never refetches an image whose URL is unchanged. The README's new "Images and other assets" section covers this, and a live patch updates a changed `src` in place.
- The CLI's `--output` file links each asset relative to itself, with a placeholder for missing ones, so the page still opens with its images. Output on stdout keeps PreTeXt's own URLs.
