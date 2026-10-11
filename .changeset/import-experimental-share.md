---
"@pretextbook/import": minor
---

The import wizard can now flag experimental converters and let authors share
what they produced.

Give an engine an `experimentalNotice` and the wizard shows it on the upload
step, before a file is chosen, and again beside any result or failure that
engine produces. Pass the new `shareConversion` prop (`{ label?, description?,
onShare }`) to add a button there that hands the host a `ConversionShare`: the
uploaded file, the engine's `id` and `label`, and the converted PreTeXt or the
error. The button appears only after a conversion, so the author decides having
seen the result. `experimentalEngines` and `experimentalEngineFor` expose the
same routing outside the wizard.
