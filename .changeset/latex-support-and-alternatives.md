---
"@pretextbook/latex-style-pretext": minor
---

Resync the curated LaTeX-style PreTeXt tables with the converter, guard them against future drift, and offer semantic replacements for presentational font macros.

**The tables had gone stale, and the drift guard could not see it.** `packages/latex-style-pretext` was resolving `@pretextbook/latex-pretext` to a stale copy of the published `0.0.13` pinned in `package-lock.json`, rather than to the workspace package — so the existing drift spec was checking against converter `0.0.4` while the workspace had moved on. Removing that pin (and declaring `@pretextbook/unified-latex-to-pretext` as a devDependency, which the refresh script needs) puts the package on converter `0.0.8`.

What that surfaced, now added: ten PreTeXt division macros (`\preface`, `\worksheet`, `\exercises`, `\solutions`, `\glossary`, `\handout`, `\biography`, `\dedication`, `\paragraphs`, `\readingquestions`), plus `\alert`, `\citep`, `\email`, `\keywords`, `\subjclass`, and the `description` environment. `\foreignlanguage` takes `{language}{text}`, not one argument. `gi`, `sbsgroup`, `stack` and `webwork` do accept a `[title]`. And `\centering`, `\newline`, `\maketitle` and `\tableofcontents` are converted upstream now, so they no longer count as unsupported.

**Keeping it in sync from here.** `npm run refresh:latex-support` regenerates `src/data/converter-support.json` from the installed converter; `npm run check:latex-support` fails when it is stale, and CI runs it. A new `converter-coverage.spec.ts` checks the direction the old guard never did — that the tables cover everything the converter supports — naming each missing entry. Because the converter exports only half its surface, the snapshot also records what it will convert when probed with every PreTeXt element name from the schema; that half is how `\alert` was found.

**Quick fixes for presentational font macros.** `\textbf` and friends are flagged rather than rewritten, because only the author knows whether bold meant a warning, a defined term, ordinary emphasis, or nothing at all. The editor now offers the whole choice, least destructive first:

- **Replace with a semantic macro** — `\alert`, `\term`, `\emph` for `\textbf`; `\emph`, `\term`, `\foreign`, `\alert` for `\textit`; `\code`/`\kbd` for `\texttt`; `\init`/`\acro`/`\term` for `\textsc`.
- **Remove the macro, keep its text** — `\textbf{bold words}` becomes `bold words`.
- **Delete the macro and its text** — the whole call goes.

Each has an "all N occurrences" twin once the macro appears more than once, the way a spell checker offers both "Change" and "Change All". "All" is scoped to that one macro, so fixing `\textbf` leaves `\textit` alone. Removal spans are computed per occurrence against the macro's curated signature, so a one-word `\textbf` and a whole-sentence one are both handled correctly in a single sweep, and `\textbf{a}{b}` does not swallow the trailing group.

All of these are deliberately excluded from the bulk "Clean up LaTeX" action and from the importer's cleaning pass: choosing among them is an editorial decision, not a defect to repair.
