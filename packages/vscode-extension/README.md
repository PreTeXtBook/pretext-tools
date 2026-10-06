# PreTeXt-tools

[![VS Marketplace Version](https://vsmarketplacebadges.dev/version-short/oscarlevin.pretext-tools.svg)](https://marketplace.visualstudio.com/items?itemName=oscarlevin.pretext-tools)
[![VS Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/oscarlevin.pretext-tools.svg)](https://marketplace.visualstudio.com/items?itemName=oscarlevin.pretext-tools)
[![Open VSX Version](https://img.shields.io/open-vsx/v/oscarlevin/pretext-tools)](https://open-vsx.org/extension/oscarlevin/pretext-tools)

A Visual Studio Code extension to make writing PreTeXt documents easier.

## Features

- Defines the PreTeXt language, automatically selecting it for `.ptx` files.
- Syntax highlighting and indentation based on XML, plus some additions like recognizing math as LaTeX.
- **Native schema validation** built into the extension's own language server — no third-party XML extension required. Get inline diagnostics with improved error messages, including duplicate-id and cross-reference checks.
- A large collection of snippets for most PreTeXt elements, plus smart completions based on the schema (tags, attributes, and cross-references).
- **Typing shortcuts**: `$x$` becomes `<m>x</m>`, a bare `<` becomes `&lt;` (or `\lt` in math), a double Enter starts a new paragraph, `theorem:` + Enter inserts a theorem, and Markdown-style `*em*`, `` `code` ``, `[links](url)` and code fences become PreTeXt markup.
- **Live Preview**: an in-editor, side-by-side preview rendered directly from the official PreTeXt stylesheets — no PreTeXt/Python installation required, and rebuilds take well under a second. Includes two-way sync: forward search jumps the preview to your cursor, and clicking in the preview jumps back to the source (inverse search).
- **Visual Editor** (experimental): a WYSIWYG, TipTap-based editor for PreTeXt documents, for authoring without touching raw XML.
- **Import Project wizard**: turn an existing LaTeX, Markdown, or Pandoc-supported document into a new PreTeXt project, with a preview of the converted structure before anything is written to disk.
- A **PreTeXt sidebar panel** with Actions (one-click build/view/generate/deploy/import/convert), Targets (build or view any target from `project.ptx` directly), and a Document Outline that follows `xi:include`.
- A front-end for the [PreTeXt-CLI](https://github.com/PreTeXtBook/pretext-cli), with commands available through a statusbar menu, keyboard shortcuts (Ctrl+Alt+P for command menu, Ctrl-Alt-B to build, Ctrl-Alt-V to view, etc.), and the command pallet (search for PreTeXt).
- Use pandoc to convert almost any file format to PreTeXt.
- Convert small passages of LaTeX to PreTeXt.
- A PreTeXt-aware formatter, with configurable blank-line style, sentence splitting, and line-wrap width.

## Usage

### Identifying PreTeXt Documents

Open the root folder of your PreTeXt project in VSCode. Open any of your source documents. If it has a `.ptx` file extension, it should be identified as a PreTeXt document, and you will see "PreTeXt" as the language in the bottom right corner of the window. You can associate other file extensions with the PreTeXt language using the "Files: Associations" setting (Ctrl+, brings up settings). Or you can select PreTeXt for a particular document using the "Change Language Mode" command.

Having a document identified as a PreTeXt document will give you:

- Syntax highlighting
- Access to snippets and completions of PreTeXt tags, attributes, and cross-references.
- Access to keyboard shortcuts for PreTeXt commands.
- Native schema validation, with diagnostics shown inline as you type.
- Better spell checking using the Code Spell Checker extension.

### Completions/Snippets

PreTeXt has a lot of markup to describe the structure of the document. To vastly speed up the authoring of the documents, the extension provides autocomplete _snippets_ for almost all of the supported tags and attributes of PreTeXt. As you type, if you start typing a tag, such as `<example>`, autocomplete will pop up a menu at your cursor suggesting this tag. If you hit ENTER (or if configured, TAB), then the snippet will expand and put your cursor in the right spot to start typing the statement of the example.

![animation showing snippets](assets/snippets.gif "snippet example")

Some shorter snippets also allow you to tab out of them. For example, start typing `<m>` and hit enter. Your cursor will be between the start and end tags. When you are done typing your math, hit tab to jump out of the tags so you can keep typing.

To wrap selected content in a tag, select it and type `<`, then the tag name (or pick it from the list): see [Typing Shortcuts](#typing-shortcuts).

Attributes are available if you start typing with "@".

If you open a new empty document that you will include via `xi:include`, save it with a `.ptx` extension and then fill in the structure with **Snippets: Insert Snippet** from the Command Palette, choosing one of the `<!ptx-` templates.

Here are some options that I find make snippets more useful. For each of these, open settings in VS code and search for them.

- Emmet: Excluded Languages. I exclude PreTeXt Emmet for PreTeXt, since the snippets behave better.
- Editor: Snippet Suggestions. This is "none" for PreTeXt files by default: the language server's completions already include every element snippet, so the contributed snippets would show up twice. They are all still available through **Snippets: Insert Snippet**. To have them in the completion list as well, change the setting for PreTeXt files specifically: search Settings for `@lang:pretext snippet suggestions`, or add this to your `settings.json`:

  ```json
  "[pretext]": {
    "editor.snippetSuggestions": "bottom"
  }
  ```

  Changing the plain "Editor: Snippet Suggestions" setting has no effect on PreTeXt files, because the extension's PreTeXt-specific default takes precedence over it.

- Editor: Tab Completion. I set this to "only snippets" so that I can hit TAB or ENTER to select the snippet.
- If you get too many snippet suggestions, experiment with the quick-suggest and completion settings. Please contribute suggestions on the best configuration if you find something that works well.

### Typing Shortcuts

A few things you type are converted to PreTeXt markup on the spot. Each conversion is its own undo step, so Ctrl+Z (Cmd+Z) gives you back exactly what you typed.

- **Math**: `$x^2$` becomes `<m>x^2</m>` as you type the closing `$`, and `$$...$$` becomes `<md>...</md>`. Dollar signs inside math, code, comments, and attributes are left alone, and a `$` typed right after a space never closes math (so "$5 or $10" is safe).
- **Escaping**: a bare `<` or `&` followed by a space becomes `&lt;` or `&amp;`, and a `>` typed after a space becomes `&gt;`. Inside math, `a < b` and `a > b` become `a \lt b` and `a \gt b`.
- **Paragraphs**: inside a `<p>`, press Enter twice (or Shift+Enter) to end the paragraph and start a new one. In a list item, the same turns the item's text into paragraphs. Outside a paragraph, Shift+Enter starts a new `<p>`.
- **Lists**: at the start of a line in a paragraph, `- ` or `* ` starts a `<ul>` and `1. ` starts an `<ol>` (`a.`, `(i)`, `A)`, ... set its marker). Inside a list item, typing a marker at the start of a line starts the next item.
- **Environments**: outside a paragraph, type an environment name and a colon on a line of its own (`theorem:`, `definition:`, `proof:`, `example:`, ...) and press Enter to insert its snippet.
- **Markdown-style markup**: `*word*` becomes `<em>word</em>`, `**word**` becomes `<alert>word</alert>`, and `` `code` `` becomes `<c>code</c>` as you type the closing delimiter. `_word_` becomes `<term>word</term>` and `"word"` becomes `<q>word</q>` when you type a space after them. `[text](url)` becomes `<url href="url">text</url>`. A delimiter that follows a letter or digit doesn't open markup, so `2*3*4` and `snake_case_names` are left alone.
- **Typography**: `--`, `---`, and `...` followed by a space become `<ndash/>`, `<mdash/>`, and `<ellipsis/>`.
- **Cross-references**: `@` typed after a space inserts `<xref ref=""/>` and opens the list of ids you can reference.
- **Code blocks**: on a line of its own, ` ```python ` + Enter inserts a `<program language="python">` block, a bare ` ``` ` + Enter inserts `<pre>`, and inside a paragraph either inserts `<cd>`.
- **Wrapping a selection**: with text selected, type `$` to wrap it in `<m>`, `*` for `<em>`, `` ` `` for `<c>`, or `"` for `<q>`. Type `<` to wrap it in any element: type the name (it goes into both tags at once) or pick it from the list, then press Tab to select the text again. Selected lines get the tags on lines of their own. The **PreTeXt: Wrap Selection in Element** command (also in the editor's context menu) does the same as `<`; bind a key to a particular element with `"args": { "element": "term" }`.

Each shortcut can be turned off in the settings under "PreTeXt › Typing Shortcuts".

### Live Preview

Run `PreTeXt: View Live Preview` (or click the preview icon) to open a side-by-side preview of your document. It renders the official PreTeXt stylesheets directly in the extension — no PreTeXt or Python installation needed — and refreshes automatically as you edit. It stays in sync with your source in both directions:

- **Forward search**: `PreTeXt: Forward Search` (or just move your cursor) scrolls the preview to match where you are in the source.
- **Inverse search**: clicking a paragraph in the preview jumps your cursor to the matching line in the source.

Use the `PreTeXt: Live Preview: Choose Scope` command, or the `pretext-tools.instantPreview.scope` setting, to preview just the current file or the whole project.

**Runtime requirements.** The preview renders the PreTeXt stylesheets through WebAssembly, which needs a JavaScript engine supporting WebAssembly JSPI. VS Code normally provides this itself, so there is nothing to install. If you see an error saying no such runtime was found — most likely on an older VS Code release, or in a remote/Codespaces window whose server runtime predates JSPI — then:

- **Updating VS Code is the easiest fix**, since it supplies the runtime the preview prefers.
- Otherwise, install **Node.js 24 or later**. Note that Node 22 will _not_ work: its version of V8 predates the `WebAssembly.Suspending` API the renderer requires, even though it accepts the relevant flag. If your Node is not on `PATH`, set `pretext-tools.instantPreview.nodePath` to its absolute path. That setting is machine-scoped, so in a remote window set it under the **Remote** tab rather than **User**.

The PreTeXt output channel records which runtime the preview selected, and what each attempt reported if none worked.

There is also an older, CLI-based `PreTeXt: Live Preview via CLI build` command (experimental), which shells out to `pretext build` and requires PreTeXt to be installed — most users should prefer the built-in Live Preview above.

### Visual Editor (experimental)

`PreTeXt: Open file with Visual Editor` opens a WYSIWYG editor for the current document, built on TipTap/ProseMirror. It lets you author and edit PreTeXt content (divisions, theorem-like blocks, math, and more) without writing raw XML, while keeping the file's underlying markup intact.

### Sidebar Panel

The PreTeXt icon in the activity bar opens a dedicated panel with three views:

- **Actions** — one-click access to the most common commands: build, view, generate assets, deploy, new/import project, convert, and format.
- **Targets** — every target defined in your `project.ptx`, each with inline build (▶) and view (👁) buttons; click a target to jump to its definition in the manifest.
- **Document Outline** — a live outline of your document's structure (divisions, and optionally block-level elements like theorems and figures), following `xi:include` across files. Click any entry to jump to it in the source.

### Importing an Existing Project

`PreTeXt: Import Project from LaTeX/Markdown/PreTeXt` opens a wizard that turns an existing document (LaTeX, Markdown, or anything Pandoc can read) into a new PreTeXt project. It shows a preview of the converted structure and lets you choose between a converted or native PreTeXt layout before anything is written to disk.

### Running PreTeXt

To build and view projects, and to generate assets, the extension calls the PreTeXt-CLI. Of course, you can open a terminal in VS Code (CTRL+\`) and type `pretext build web`, but you can also get more visual feedback by using the PreTeXt button in the bottom status bar, the PreTeXt sidebar panel, the keyboard shortcut Ctrl+Alt+P, or through the command pallet (CTRL+SHIFT+P). Follow the menus to select the command you want to run.

In particular, if you are working with multiple projects in the same window, you might need to refresh your list of targets (this list is determined by looking at the `project.ptx` manifest, but is set once when a project is opened).

All this assumes you that have the PreTeXt-CLI installed. The extension will try to install this for you if not, but that still requires Python 3.8.5 or later, and PIP to be installed. If you don't have that yet, see the [PreTeXt documentation](https://pretextbook.org/doc/guide/html/quickstart-getting-pretext.html).

If you have PreTeXt-CLI installed in a virtual environment, or have a non-standard way of calling python, you can set the path to the python executable (of your virtual environment of system) in the "python Path" setting.

### Formatting

Using the command pallet, you can request to "Format Document With..." and select "pretext-tools" as the formatter. You can also set this as the default from that menu. In settings, you can specify to "Split Sentences" which will take long paragraphs and start new lines after each period, control how many blank lines are inserted between elements, and set a "Print Width" to wrap long lines at a given column (set to 0 to disable wrapping).

Consider setting "Format on Save" to keep your document nicely formatted always.

### Converting to PreTeXt

You can convert selected LaTeX to PreTeXt using the `PreTeXt: Convert LaTeX to PreTeXt` command from the command pallet. This will not work for all LaTeX, and is not guaranteed to produce valid PreTeXt, but it should get you close.

If you have pandoc installed, you can convert almost any format of document to PreTeXt using the `PreTeXt: Convert to PreTeXt` command from the command pallet.

To turn a whole existing document into a new PreTeXt project (rather than converting a snippet), use the `PreTeXt: Import Project from LaTeX/Markdown/PreTeXt` wizard described above.

## Change log

You can track the ongoing development progress in the [Changelog](CHANGELOG.md).

## Contributions

Like this extension? [Star it on GitHub](https://github.com/PreTeXtBook/pretext-tools)!

Do you have an idea or suggestion? [Open a feature request](https://github.com/PreTeXtBook/pretext-tools/issues).

Found something wrong? [File an issue](https://github.com/PreTeXtBook/pretext-tools/issues).

Pull requests welcome.
