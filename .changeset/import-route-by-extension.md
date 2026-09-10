---
"@pretextbook/import": minor
---

Route imports to a converter by file extension instead of asking the author to pick one.

The wizard's converter radio group is gone. The file picker now accepts every format any registered engine reads, and the upload is routed by its extension: a `.docx` goes to pandoc and a `.zip` project goes to the built-in converter without the author having to know which is which. A file nothing reads gets a message naming the supported types instead of silently doing nothing.

The manual override moved to the review step, where the author can see the result it applies to. It appears only when the file that was actually loaded has a second converter that could read it — for a Word file or a zipped project there is nothing to switch to, so nothing is offered — and toggling it re-runs the import through the other converter. The error step offers the same switch as a button.

`ImportEngine.label` and `description` now surface in that override and in error messages rather than in a menu; engine order is precedence, so list the engine that should own a shared format first. New `lib/engine-routing` helpers (`routeEngine`, `alternateFor`, `allAcceptExtensions`, `alternateEngine`, `unsupportedFileMessage`) are exported for hosts that need the same routing outside the wizard.
