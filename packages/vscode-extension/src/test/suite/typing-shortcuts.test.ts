import * as assert from "assert";
import * as vscode from "vscode";

/**
 * Integration coverage for the typing shortcuts: real keystrokes through
 * VS Code's `type` command (so auto-indent and auto-whitespace trimming shape
 * the change events exactly as they do for an author), then the shortcut
 * edits the extension applies in response.
 */

const EXTENSION_ID = "oscarlevin.pretext-tools";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until the document has stopped changing (a shortcut edit has landed). */
async function settle(document: vscode.TextDocument): Promise<void> {
  let version = -1;
  while (version !== document.version) {
    version = document.version;
    await sleep(80);
  }
}

/** Open a PreTeXt document with `|` marking the caret. */
async function open(marked: string): Promise<vscode.TextEditor> {
  const caret = marked.indexOf("|");
  const content = marked.slice(0, caret) + marked.slice(caret + 1);
  const document = await vscode.workspace.openTextDocument({
    language: "pretext",
    content,
  });
  const editor = await vscode.window.showTextDocument(document);
  editor.options = { insertSpaces: true, tabSize: 2 };
  const position = document.positionAt(caret);
  editor.selection = new vscode.Selection(position, position);
  return editor;
}

async function typeKeys(editor: vscode.TextEditor, ...keys: string[]) {
  for (const key of keys) {
    await vscode.commands.executeCommand("type", { text: key });
    await settle(editor.document);
  }
}

/** The document text with `|` at the caret. */
function marked(editor: vscode.TextEditor): string {
  const text = editor.document.getText();
  const caret = editor.document.offsetAt(editor.selection.active);
  return text.slice(0, caret) + "|" + text.slice(caret);
}

const lines = (...parts: string[]) => parts.join("\n");

suite("Typing shortcuts", () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
  });

  test("$x$ becomes <m>x</m>, and undo restores $x$", async () => {
    const editor = await open("<p>Let |</p>");
    await typeKeys(editor, "$", "x", "$");
    assert.strictEqual(marked(editor), "<p>Let <m>x</m>|</p>");

    await vscode.commands.executeCommand("undo");
    await settle(editor.document);
    assert.strictEqual(editor.document.getText(), "<p>Let $x$</p>");
  });

  test("a bare < becomes &lt; in text and \\lt in math", async () => {
    const editor = await open("<p>|</p>");
    await typeKeys(editor, ..."a < b and <m>c < d".split(""));
    assert.strictEqual(
      editor.document.getText(),
      "<p>a &lt; b and <m>c \\lt d</p>",
    );
  });

  test("a double Enter ends the paragraph and starts the next", async () => {
    const editor = await open(
      lines("<section>", "  <p>", "    One.|", "  </p>", "</section>"),
    );
    await typeKeys(editor, "\n", "\n");
    assert.strictEqual(
      marked(editor),
      lines(
        "<section>",
        "  <p>",
        "    One.",
        "  </p>",
        "  <p>",
        "    |",
        "  </p>",
        "</section>",
      ),
    );
  });

  test("a single Enter at the start of a line is just a line break", async () => {
    const editor = await open(lines("<p>", "  One.", "  |Two.", "</p>"));
    await typeKeys(editor, "\n");
    assert.ok(
      !editor.document.getText().includes("</p>\n"),
      editor.document.getText(),
    );
  });

  test("Shift+Enter splits a paragraph, or starts one outside a paragraph", async () => {
    const editor = await open(
      lines("<section>", "  <p>One. |Two.</p>", "  ", "</section>"),
    );
    await vscode.commands.executeCommand("pretext-tools.newParagraph");
    await settle(editor.document);
    assert.strictEqual(
      marked(editor),
      lines("<section>", "  <p>One.</p>", "  <p>|Two.</p>", "  ", "</section>"),
    );

    const blankLine = new vscode.Position(3, 2);
    editor.selection = new vscode.Selection(blankLine, blankLine);
    await vscode.commands.executeCommand("pretext-tools.newParagraph");
    await settle(editor.document);
    assert.strictEqual(
      marked(editor),
      lines(
        "<section>",
        "  <p>One.</p>",
        "  <p>Two.</p>",
        "  <p>",
        "    |",
        "  </p>",
        "</section>",
      ),
    );
  });

  test("theorem: + Enter expands the theorem snippet", async () => {
    const editor = await open(lines("<section>", "  |", "</section>"));
    await typeKeys(editor, ..."theorem:".split(""), "\n");
    assert.strictEqual(
      marked(editor),
      lines(
        "<section>",
        '  <theorem xml:id="thm-|">',
        "    <statement>",
        "      <p>",
        "        ",
        "      </p>",
        "    </statement>",
        "  </theorem>",
        "</section>",
      ),
    );
  });
});
