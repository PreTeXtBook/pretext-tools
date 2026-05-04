# PreTeXt-tools

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/oscarlevin.pretext-tools?color=informational&logo=visualstudiocode&style=for-the-badge&label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=oscarlevin.pretext-tools)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/oscarlevin.pretext-tools?logo=visualstudiocode&color=informational&style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=oscarlevin.pretext-tools)

A Visual Studio Code extension to make writing PreTeXt documents easier.

## Features

- Defines the PreTeXt language, automatically selecting it for `.ptx` files.
- Syntax highlighting and indentation based on XML, plus some additions like recognizing math as LaTeX.
- Schema support via the [vscode-xml](https://github.com/redhat-developer/vscode-xml) extension (which also provides many xml tools).
- A large collection of snippets for most PreTeXt elements.  Smart completions based on the schema.
- A front-end for the [PreTeXt-CLI](https://github.com/PreTeXtBook/pretext-cli), with commands available through a statusbar menu, keyboard shortcuts (Ctrl+Alt+P for command menu, Ctrl-Alt-B to build, Ctrl-Alt-V to view, etc.), and the command pallet (search for PreTeXT).
- Support for the CodeChat extension to view output, as well as via the PreTeXt-CLI.
- Use pandoc to convert almost any file format to PreTeXt.
- Convert small passages of LaTeX to PreTeXt (experimental).
- Formatter specific to PreTeXt (experimental).

## Usage

### Identifying PreTeXt Documents

Open the root folder of your PreTeXt project in VSCode. Open any of your source documents. If it has a `.ptx` file extension, it should be identified as a PreTeXt document, and you will see "PreTeXt" as the language in the bottom right corner of the window. You can associate other file extensions with the PreTeXt language using the "Files: Associations" setting (Ctrl+, brings up settings). Or you can select PreTeXt for a particular document using the "Change Language Mode" command.

Having a document identified as a PreTeXt document will give you:

- Syntax highlighting
- Access to snippets and completions of PreTeXt tags, attributes, and cross-references.
- Access to keyboard shortcuts for PreTeXt commands.
- Schema validation (via required vscode-xml extension).
- Better spell checking using the Code Spell Checker extension.

### Completions/Snippets

PreTeXt has a lot of markup to describe the structure of the document. To vastly speed up the authoring of the documents, the extension provides autocomplete _snippets_ for almost all of the supported tags and attributes of PreTeXt. As you type, if you start typing a tag, such as `<example>`, autocomplete will pop up a menu at your cursor suggesting this tag. If you hit ENTER (or if configured, TAB), then the snippet will expand and put your cursor in the right spot to start typing the statement of the example.

![animation showing snippets](assets/snippets.gif "snippet example")

Some shorter snippets also allow you to tab out of them. For example, start typing `<m>` and hit enter. Your cursor will be between the start and end tags. When you are done typing your math, hit tab to jump out of the tags so you can keep typing.

Short tags like `<m>` and `<c>` and `<em>` can also be used to wrap selected content. Select the string of characters you want inside the tag, and start typing the tag name, then hit enter when given the option. The selected text should be restored with the start and end tags surrounding it.

Attributes are available if you start typing with "@".

If you open a new empty document that you will include via `xi:include`, save it with a `.ptx` extension and then fill in the structure using a "!" snippet.

Here are some options that I find make snippets more useful. For each of these, open settings in VS code and search for them.

- Emmet: Excluded Languages. I exclude PreTeXt Emmet for PreTeXt, since the snippets behave better.
- Editor: Snippets Suggestions. I set this to "bottom" so that the snippets are shown after other autocomplete suggestions.
- Editor: Tab Completion. I set this to "only snippets" so that I can hit TAB or ENTER to select the snippet.
- If you get too many snippet suggestions, experiment with the quick-suggest and completion settings. Please contribute suggestions on the best configuration if you find something that works well.

### Running PreTeXt

To build and view projects, and to generate assets, the extension calls the PreTeXt-CLI. Of course, you can open a terminal in VS Code (CTRL+\`) and type `pretext build web`, but you can also get more visual feedback by using the PreTeXt button in the bottom status bar, or the keyboard shortcut Ctrl+Alt+P or through the command pallet (CTRL+SHIFT+P). Follow the menus to select the command you want to run.

In particular, if you are working with multiple projects in the same window, you might need to refresh your list of targets (this list is determined by looking at the `project.ptx` manifest, but is set once when a project is opened).

All this assumes you that have the PreTeXt-CLI installed. The extension will try to install this for you if not, but that still requires Python 3.8.5 or later, and PIP to be installed. If you don't have that yet, see the [PreTeXt documentation](https://pretextbook.org/doc/guide/html/quickstart-getting-pretext.html).

If you have PreTeXt-CLI installed in a virtual environment, or have a non-standard way of calling python, you can set the path to the python executable (of your virtual environment of system) in the "python Path" setting.

### Formatting

Using the command pallet, you can request to "Format Document With..." and select "pretext-tools" as the formatter.  You can also set this as the default from that menu.  In settings, you can specify to "Split Sentences" which will take long paragraphs and start new lines after each period.  You can also specify whether you want no, some, or lots of blank lines inserted in the settings. 

Consider setting "Format on Save" to keep your document nicely formatted always.

### Converting to PreTeXt

While we are still trying to find a better solution for converting documents to PreTeXt, you can use some tools to attempt this conversion already.  
- To convert the contents of the current active editor, or selected text, `PreTeXt: Convert to PreTeXt` from the command palette or the PreTeXt toolbar menu.  You will be prompted to choose the format of the incoming text.
- To convert an entire LaTeX file, using Pandoc (which must be installed separately) or PlasTeX, select `PreTeXt: Convert external file to PreTeXt`.  Note that depending on the LaTeX source file, the PlasTeX-based conversion might fail silently.

## Change log

You can track the ongoing development progress in the [Changelog](CHANGELOG.md).

## Development

This monorepo contains the VS Code extension (`packages/vscode-extension`) and several supporting packages for PreTeXt language support, formatting, and conversion.

### Building

Build the main VS Code extension:
```bash
npm run build
```

Build all packages (without the extension):
```bash
npm run build:packages
```

Build a specific package:
```bash
npm run build -w @pretextbook/format
```

### Development Mode

Watch mode for the extension:
```bash
npm run watch
```

### Testing

Run all tests:
```bash
npm test
```

Test a specific package:
```bash
npm run test -w @pretextbook/completions
```

### Linting

Lint all packages:
```bash
npm run lint
```

### Installing Dependencies

This workspace uses npm workspaces. After cloning, install dependencies with:
```bash
npm install
```

## Contributions

Like this extension? [Star it on GitHub](https://github.com/oscarlevin/pretext-tools/stargazers)!

Do you have an idea or suggestion? [Open a feature request](https://github.com/oscarlevin/pretext-tools/issues).

Found something wrong? [File an issue](https://github.com/oscarlevin/pretext-tools//issues).

Pull requests welcome.
