---
"@pretextbook/completions": minor
---

Export the element snippet table as `ELEMENTS`, and depend on the side-effect-free `vscode-languageserver-types` instead of `vscode-languageserver`, so the package no longer pulls language-server runtime code into browser or extension-host bundles.
