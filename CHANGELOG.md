## 0.0.1 (2025-12-21)

This was a version bump only, there were no code changes.

## 0.0.5 (2025-12-21)

This was a version bump only, there were no code changes.

## 0.0.4 (2025-12-21)

This was a version bump only, there were no code changes.

## 0.0.3 (2025-12-21)

This was a version bump only, there were no code changes.

# Change Log

All notable changes to the "pretext-tools" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [UNRELEASED]

## [0.34.0] - 2025-12-10

### Added

- New snippets for slideshows and handouts.

### Changed

- Snippets for `<me>` now resolve to `<md>` to match updates to pretext.

## [0.33.0] - 2025-07-24

### Changed

- Consolidate convert to PreTeXt functions into two commands, one for external files, another for the current editor/selection.

### Added

- Experimental functions, available via a setting, to help with development.

## [0.32.4] - 2025-07-22

- Fixed bug that once again prevented `view` command in codespaces when using the pretext button.

## [0.32.3] - 2025-07-08

Minor bug fixes

## [0.32.2] - 2025-06-16

Minor bug fixes

## [0.32.1] - 2025-06-13

Minor bug fixes

## [0.32.0] - 2025-06-04

### Added

- Support for hint, answer, and solution in latex to pretext inline converter.

### Fixed

- Format selection was formatting the entire document and replacing the selection with it.
- Convert mixed content to pretext was formatting the entire document after converting a selection.

## [0.31.2] - 2025-06-02

### Fixed

- The pretext button menu used the wrong function for the "convert mixed content" command.

## [0.31.1] - 2025-05-29

### Fixed

- Building standalone/current document bug that didn't show possible default targets.

## [0.31.0] - 2025-05-23

### Fixed

- Updated location of standalone-project.ptx to match next CLI release.

## [0.30.1] - 2025-05-21

### Fixed

- View command now finds targets correctly.

## [0.30.0] - 2025-05-21

### Added

- Build current document available from pretext menu; allows selection of output format.
- Allows include system default targets (must be configured in `~/.ptx` by the CLI).
- "Covert mixed text to PreTeXT" command added to pretext menu.

## [0.29.2] - 2025-05-19

### Changed

- Formatter respects editor tabSize and insertSpaces settings.

## [0.29.1] - 2025-05-16

### Changed

- Updated converter

## [0.29.0] - 2025-05-15

### Changed

- Use "classic" formatting within the LSP.
- Improved the "Convert to PreTeXt" function.

## [0.28.1] - 2025-05-12

### Added

- Convert document to proper PreTeXt from "FrankenMarkUp" (or FlexTeXt?).

### Changed

- Switched (again) to use prettier for formatting instead of custom formatter.

## [0.28.0] - 2025-05-07

### Added

- Experimental *Visual Editor* for PreTeXt documents.

## [0.27.1] - 2025-04-10

### Added

- Command to open the PreTeXt getting started walkthrough.

### Fixed

- Fixed bug that prevented `installSage.sh` from running in a codespace.

## [0.27.0] - 2025-04-07

### Added

- Command that will run the `installSage.sh` script inside a codespace (and enable that for all future codespaces).

## [0.26.0] - 2025-04-03

### Added

- New "Getting started with PreTeXt" walkthrough to help new users create, build, and view a PreTeXt project.

### Changed

- New Project command now creates a new project inside the selected folder instead of creating a new "New PreTeXt Project" folder.

## [0.25.4] - 2025-03-31

### Fixes

- Improved formatting issues.

## [0.25.3] - 2025-03-30

### Fixes

- Restored the markdown-to-pretext command.
- Reverted to non-prettier based formatting, so formatting is at least somewhat working.

## [0.25.2] - 2025-03-28

### Fixes

- Fixed bug prevent formatter from working (but it's still not working).

## [0.25.1] - 2025-03-28

### Fixed

- Prevent language server from crashing when invalid schema path is used.

## [0.25.0] - 2025-02-25

### Changed

- Formatting now handled by a prettier pretext plugin (you do not need Prettier installed). Should produce nicer formatting.
- Conversion of LaTeX to PreTeXt has been updated to handle theorem-like blocks.

## [0.24.1] - 2025-01-06

### Fixed

- Bug with `pretext deploy` command due to not setting project root correctly.

## [0.24.0] - 2024-12-30

### Added

- Commands now work with any number of projects in the workspace (including zero).

## [0.23.0] - 2024-12-12

### Added

- Command to build current file as a standalone document. Produces a PDF adjacent to the current document.

## [0.22.0] - 2024-12-06

### Added

- Convert selections of markdown text to PreTeXt.

### Changed

- Conversion of selected LaTeX to PreTeXt now completed via UnifiedLatex, which should be much more reliable.

## [0.21.2] - 2024-11-04

### Fixed

- Bug: view command was not working in a codespace.

## [0.21.1] - 2024-10-25

### Added

- Completions/snippets for project.ptx manifest file.
- Completions/snippets for publication files.

### Fixed

- Re-enabled old-style snippets.

## [0.21.0] - 2024-10-17

### Changed

- Completions now use a Language Server Provider, which should improve performance.
- Completions use configurable RelaxNG schema, allowing for all possible completions given current position.
- Old snippets mostly removed in favor of these new completions.

### Fixed

- Performance enhancements; some features still available even if pretext isn't installed.

## [0.20.2] - 2024-08-04

### Fixed

- Bug: Spell check ignoring words it shouldn't.

### Added

- `<instruction>` snippet for webwork.

## [0.20.1] - 2024-07-15

### Fixed

- UI improvements to work with CLI v2.5

## [0.20.0] - 2024-07-14

### Added

- Configuration defaults for cSpell spell checker to enable spell checking in pretext documents, and to ignore words inside tags and between math-mode tags (`<m>`, `<me>`, etc.).
- Spell check scopes are configurable: you can specify whether to check or ignore spelling inside comments, math, latex-image, code, etc.
- Support for CLI 2.5+ schema locations.

### Changed

- Improved feedback messages when running PreTeXt commands.

### Fixed

- Garbled log messages in the output pain are now not garbled.

## [0.19.0] - 2024-07-06

### Added

- Blank Lines formatting option to specify whether no, some, or many blank lines are added between elements.
- New snippets/completions.

### Fixed

- Bugs with formatting.
- Formatting now respects editor's choice of tab/space for indentation.
- Conversion of selection: convert reserved characters (&, <, >) to entities.

## [0.18.0] - 2024-05-14

### Added

- Add plastex converter
- New snippets/completions

### Fixed

- Bugs with selection converter

## [0.17.0] - 2024-02-25

### Added

- Support for running pretext in a virtual environment.
- Completion to close the current tag when typing `</` (like `</tag>`).
- Snippets for new documents.
- PreTeXt version reported in status bar tool-tip.

### Changed

- Make default `ctrl+alt+b` keybinding build the most recently built target (or default).

### Fixed

- Broken snippets

## [0.16.0] - 2024-02-10

### Added

- New setting allows you to set a custom pretext schema.
- Completions suggest file names for `xi:include`

### Changed

- Remove vscode-xml's cross reference suggestions in favor of pretext-tools version.
- Set default workspace settings to hide "properties" completion type so that duplicate suggestions from vscode-xml don't show.
- Added and improved the scope settings for many snippets.

### Fixed

- Bug that incorrectly identified the current open tag for snippet suggestions

## [0.15.1] - 2024-01-21

### Changed

- Scan for reference labels starting at the main source file and following xi:included links.
- Show snippets as completion options more unless explicitly excluded.

### Fixed

- Bug that crashed extension when no reference labels were found.

## [0.15.0] - 2024-01-16

### Added

- `<xref ref="..."/>` will now suggest xml:ids from any file in the `source` directory.

### Changed

- Snippets are now completion items, which limits when they show up as suggestions based on context.
- View in codechat or browser given as options in main menu.
- `Deploy to GitHub` now makes a commit to save recent work (using the `-u` option).

### Fixed

- Formatter correctly adds empty line at end of document.

## [0.14.1] - 2023-12-14

### Added

- New option to break paragraphs into separate lines for each sentence when formatting.

### Fixed

- Formatting no longer removes unknown tags (bug).
- Detection of math using `\(...\)` in latex to pretext conversion.

### Removed

- Deprecated "Live Preview" as a view option (use "CodeChat" instead).

## [0.14.0] - 2023-12-12

### Added

- Formatting support using vs-code's built-in formatting engine. From the command palette, select "Format Document".

### Fixed

- Bug that prevent initialization if not in a pretext project folder.

## [0.13.0] - 2023-11-27

### Added

- Experimental support for converting selected LaTeX to PreTeXt.

## [0.12.2] - 2023-09-12

### Fixed

- Bug that doesn't stop notification when using `pretext view` fixed.

## [0.12.0] - 2023-09-08

### Changed

- First quickPick menu item now builds most recently built target (or default).
- Target select menu no longer reorders targets.
- `generate` no longer in quickPick menu (since `pretext build` automatically generates assets that have changed).
- Only one error notification when process produces an error, with an option to view log.

### Added

- New Button Menu Options: You can now refresh the list of targets and initiate a "Convert to PreTeXt" from the PreTeXt button menu.
- Progress notification for most commands.

### Fixed

- Fixed bug producing warning when clicking on the pretext button while running (undefined state).

## [0.11.3] - 2023-07-09

### Fixed

- Fix issue with schema not loading on activation.

## [0.11.2] - 2023-05-19

### Fixed

- Check for pandoc passes even if pandoc 2 is installed.
- "li-d" snippet fixed.
- Fix workspace attribute and page block snippets.

## [0.11.1] - 2023-05-15

### Added

- `CTRL+ALT+p` now brings up the "run pretext command" selection menu

### Removed

- No longer have green "run" button at top of window (Pretext status bar button makes that redundant).

## [0.11.0] - 2023-05-12

### Added

- New function to use pandoc to convert an arbitrary file to PreTeXt. Pandoc must already be installed.

## [0.10.1] - 2023-04-28

### Fixed

- If pretext is not installed, ask user whether they want to try to install, with option to stop asking.

## [0.10.0] - 2023-03-11

### Added

- Status bar item: click to select a pretext command; shows when pretext is running; displays success/warnings (and opens output channel if clicked while running or on warning).
- Debug mode: clicking status bar or run icon includes option to run pretext commands in a terminal, allowing a user to interact or debug issues.
- View output/dismiss buttons on success message popup.
- Show log/dismiss buttons on error message popup.

### Fixed

- All output (both stdout and stderr) shown in output channel.
- Better status messages for warnings and success messages.

### Changed

- Output channel not shown by default.
- Removed PreTeXt-Commands menu (functionality replaced by status bar button)

## [0.9.0]

### Added

- Setting to decide schema version (Stable/Experimental) ready for updated schema from the CLI.
- Set default value for `xml.references` so that `<xref ref="foo"/>` is linked to `@xml:id="foo"`.

### Fixed

- Snippets that insert sanitized version of title as the xml:id remove all punctuation.
- PreTeXt Commands menu persists as long as extension is active.

## [0.8.1] - 2023-01-02

### Fixed

- Pretext commands menu will be expanded by default first time it is used.

## [0.8.0] - 2022-12-21

### Added

- Menu of available commands shows in explorer view.
- Support for Live Preview and CodeChat to view output. User is asked which of the available methods to use, or can select a default in settings.
- New snippets to create template part, chapter, section, exercises subfiles.

### Changed

- Commands now categorized as "PreTeXt" instead of "PreTeXt Tools".
- Generate command now asks for target for which assets should be generated.

## [0.7.1] - 2022-12-21

### Fixed

- Fixed file pattern for schema checking
- Set default configuration of XML package to follow xinclude elements.
- Improved a few snippets

## [0.7.0]

### Added

- Support for PreTeXt schema validation via (now required) vscode-xml extension
- Build icon on top of editor

### Fixed

- Snippets only appear on pretext document, not any XML document

## [0.6.0]

### Added

- PreTeXt is now a language, autodetected on ".ptx" files.
- New keybindings for build, view, and generate.
- Reorganized functions that call the CLI.
- CLI functions get list of targets from the project manifest.
- Checks for the CLI being installed; otherwise tries to install it.
- New snippets: console, creator, pre, cdata, <, &, all remark-like blocks, outcomes, computation, technology.
- More tags now wrap selected text (e.g., c, em, term, etc)

## [0.5.0] - 2022-06-20

### Changed

- Most snippets now start with `<`
- Move of repository on github to just oscarlevin/pretext-tools

### Fixed

- Tabular snippet has correct closing tag

## [0.4.1] - 2021-07-28

### Fixed

- Improved highlighting of math inside md and mdn.

## [0.4.0] - 2021-07-16

### Added

- New commands registered that allow you to build and view PreTeXt documents in various formats by calling the PreTeXt-CLI (which needs to be installed).

## [0.3.0] - 2020-10-30

### Added

- New snippets: url, url-empty, email, code-display, cline, alert, delete, insert, stale, foreign, taxon, pubtitle, articletitle, youtube, tag, tage, attribute, fillin.
- If text is selected, using m snippet keeps selected text (inside m).
- Grammar now selects stray less-than characters as illegal
- Grammar now bolds terms and alerts, specifies titles, and marks up code as raw.

### Fixed

- Now all snippets indent with tabs/spaces consistent with users settings.
- Tabstop on theorem snippet works.
- me with permid now gets highlighted as math

## [0.2.0] - 2020-05-11

### Fixed

- Now all snippets indent with tabs/spaces consistent with users settings.

## [0.1.3] - 2019-09-04

### Added

- new snippets: exercise-worksheet; exercise-numbered; @number; mdn.

### Fixed

- Set final tabstop for paragraphs to $0, so that additional snippets can be deployed.
- Fixed bug causing !ptx-article to appear when not wanted.

## [0.1.2] - 2019-08-19

### Added

- reading questions snippets
- worksheets snippets (including @workspace and pagebreak)

## [0.1.0] - 2019-08-18

### Initial release. Added

- Some basic extensions to the xml grammar:
  - permid attributes are highlighted as comments.
  - math is highlighted as LaTeX does.
  - Commented "TODO" highlighted as keyword.
- A healthy collection of snippets to get started.
  - Should have all divisions and environments.
  - Has a few attributes to help remember what can go where.
  - A start on longer "templates", allowing a new pretext document to be filled in.
