import { describe, expect, it, vi } from "vitest";
import { registerMonacoTypingShortcuts } from "./monaco";
import { doc, show } from "./spec-utils";

class FakeRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
  getStartPosition() {
    return { lineNumber: this.startLineNumber, column: this.startColumn };
  }
  getEndPosition() {
    return { lineNumber: this.endLineNumber, column: this.endColumn };
  }
}

const monaco = {
  Range: FakeRange,
  Selection: FakeRange,
  KeyMod: { Shift: 1024 },
  KeyCode: { Enter: 3 },
};

interface Position {
  lineNumber: number;
  column: number;
}

/**
 * A stand-in for a Monaco editor and its model, just thick enough for the
 * adapter: edits fire `onDidChangeModelContent` synchronously, as Monaco does.
 */
const makeEditor = (
  marked: string,
  { snippets = true }: { snippets?: boolean } = {},
) => {
  let { source, caret } = doc(marked);
  // The selection runs from the caret to here, when there is one.
  let selectionEnd: number | null = null;
  let listener: ((event: any) => void) | null = null;
  const actions: any[] = [];
  const snippetInsert = vi.fn();
  const pushStackElement = vi.fn();

  const getPositionAt = (offset: number): Position => {
    const before = source.slice(0, offset).split("\n");
    return {
      lineNumber: before.length,
      column: before[before.length - 1].length + 1,
    };
  };
  const getOffsetAt = ({ lineNumber, column }: Position): number => {
    const lines = source.split("\n");
    let offset = 0;
    for (let i = 0; i < lineNumber - 1; i++) offset += lines[i].length + 1;
    return offset + column - 1;
  };
  const replace = (
    start: number,
    end: number,
    text: string,
    event: object = {},
  ) => {
    const rangeLength = end - start;
    source = source.slice(0, start) + text + source.slice(end);
    selectionEnd = null;
    listener?.({
      changes: [{ rangeOffset: start, rangeLength, text }],
      ...event,
    });
  };
  const offsetsOf = (range: FakeRange) => [
    getOffsetAt(range.getStartPosition()),
    getOffsetAt(range.getEndPosition()),
  ];

  const model = {
    getValue: () => source,
    getPositionAt,
    getOffsetAt,
    getOptions: () => ({ insertSpaces: true, tabSize: 4, indentSize: 2 }),
    getEOL: () => "\n",
    pushStackElement,
  };
  const editor = {
    getModel: () => model,
    getPosition: () => getPositionAt(selectionEnd ?? caret),
    getSelection: () => {
      const from = getPositionAt(caret);
      const to = getPositionAt(selectionEnd ?? caret);
      return new FakeRange(
        from.lineNumber,
        from.column,
        to.lineNumber,
        to.column,
      );
    },
    getSelections: () => [editor.getSelection()],
    setSelection: (range: FakeRange) => {
      [caret, selectionEnd] = offsetsOf(range);
    },
    onDidChangeModelContent: (cb: (event: any) => void) => {
      listener = cb;
      return { dispose: () => (listener = null) };
    },
    executeEdits: (
      _source: string,
      edits: any[],
      cursor: () => FakeRange[] | null,
    ) => {
      for (const edit of edits) {
        const [start, end] = offsetsOf(edit.range);
        replace(start, end, edit.text);
      }
      const selection = cursor()?.[0];
      if (selection) caret = offsetsOf(selection)[0];
    },
    getContribution: (id: string) =>
      snippets && id === "snippetController2"
        ? { insert: snippetInsert }
        : null,
    addAction: (action: any) => {
      actions.push(action);
      return { dispose: () => actions.splice(actions.indexOf(action), 1) };
    },
    trigger: vi.fn(
      (_source: string, handler: string, payload: { text: string }) => {
        if (handler === "type") editor.type(payload.text);
      },
    ),
    /** Select `start`–`end`. */
    select: (start: number, end: number) => {
      caret = start;
      selectionEnd = end;
    },
    /**
     * Simulate typing `open` over the selection with auto-surround: both
     * characters go in as one event, and the text between stays selected.
     */
    surround: (open: string, close: string) => {
      const start = caret;
      const end = selectionEnd ?? caret;
      source =
        source.slice(0, start) +
        open +
        source.slice(start, end) +
        close +
        source.slice(end);
      caret = start + 1;
      selectionEnd = end + 1;
      listener?.({
        changes: [
          { rangeOffset: end, rangeLength: 0, text: close },
          { rangeOffset: start, rangeLength: 0, text: open },
        ],
      });
    },
    /** Simulate a keystroke (no auto-indent). */
    type: (text: string, event: object = {}) => {
      const at = caret;
      caret += text.length;
      replace(at, at, text, event);
    },
  };
  return {
    editor,
    actions,
    snippetInsert,
    pushStackElement,
    get text() {
      return show({ source, caret });
    },
  };
};

describe("registerMonacoTypingShortcuts", () => {
  it("converts as the author types, placing the caret after the result", () => {
    const fake = makeEditor("<p>Let |</p>");
    registerMonacoTypingShortcuts(monaco, fake.editor);
    for (const ch of "$x$ and a <") fake.editor.type(ch);
    fake.editor.type(" ");
    expect(fake.text).toBe("<p>Let <m>x</m> and a &lt; |</p>");
  });

  it("makes each shortcut its own undo step", () => {
    const fake = makeEditor("<p>|</p>");
    registerMonacoTypingShortcuts(monaco, fake.editor);
    for (const ch of "$x$") fake.editor.type(ch);
    expect(fake.pushStackElement).toHaveBeenCalledTimes(2);
  });

  it("ignores undo/redo and remote changes, and forgets a pending Enter", () => {
    let remote = false;
    const fake = makeEditor("<p>One.|</p>");
    registerMonacoTypingShortcuts(monaco, fake.editor, {
      isRemoteChange: () => remote,
    });
    fake.editor.type("\n");
    remote = true;
    fake.editor.type("$");
    remote = false;
    fake.editor.type("\n");
    expect(fake.text).toBe("<p>One.\n$\n|</p>");

    fake.editor.type("$x$", { isUndoing: true });
    expect(fake.text).toBe("<p>One.\n$\n$x$|</p>");
  });

  it("lets the host veto an edit", () => {
    const fake = makeEditor("<p>|</p>");
    registerMonacoTypingShortcuts(monaco, fake.editor, {
      canEdit: () => false,
    });
    for (const ch of "$x$") fake.editor.type(ch);
    expect(fake.text).toBe("<p>$x$|</p>");
  });

  it("splits a paragraph on a double Enter", () => {
    const fake = makeEditor("<p>One.|</p>");
    registerMonacoTypingShortcuts(monaco, fake.editor);
    fake.editor.type("\n");
    fake.editor.type("\n");
    expect(fake.text).toBe("<p>One.</p>\n<p>|</p>");
  });

  it("inserts environments through the snippet controller", () => {
    const fake = makeEditor("<section>\n|\n</section>");
    registerMonacoTypingShortcuts(monaco, fake.editor);
    for (const ch of "proof:\n") fake.editor.type(ch);
    expect(fake.snippetInsert).toHaveBeenCalledWith(
      "<proof>\n\t<p>\n\t\t$0\n\t</p>\n</proof>",
    );
    // The selection covers `proof:` and the Enter, for the snippet to replace.
    expect(fake.text).toBe("<section>\n|proof:\n\n</section>");
  });

  it("falls back to plain text without a snippet controller", () => {
    const fake = makeEditor("<section>\n|\n</section>", { snippets: false });
    registerMonacoTypingShortcuts(monaco, fake.editor);
    for (const ch of "proof:\n") fake.editor.type(ch);
    expect(fake.text).toBe(
      "<section>\n<proof>\n\t<p>\n\t\t|\n\t</p>\n</proof>\n</section>",
    );
  });

  it("adds a Shift+Enter action that starts a paragraph or types a newline", () => {
    const fake = makeEditor("<section>\n  |\n</section>");
    registerMonacoTypingShortcuts(monaco, fake.editor);
    const [action] = fake.actions;
    expect(action.keybindings).toEqual([
      monaco.KeyMod.Shift | monaco.KeyCode.Enter,
    ]);

    action.run();
    expect(fake.text).toBe("<section>\n  <p>\n    |\n  </p>\n</section>");

    fake.editor.type("<");
    fake.editor.type("m");
    action.run();
    expect(fake.text).toBe("<section>\n  <p>\n    <m\n|\n  </p>\n</section>");
  });

  it("skips the Shift+Enter action when paragraphs are off", () => {
    const fake = makeEditor("<p>|</p>");
    registerMonacoTypingShortcuts(monaco, fake.editor, { paragraphs: false });
    expect(fake.actions.map((action) => action.id)).toEqual([
      "pretext.typingShortcuts.wrapSelection",
    ]);
  });

  it("wraps a selection typed over with $ or <", () => {
    const fake = makeEditor("<p>Let |x be.</p>");
    registerMonacoTypingShortcuts(monaco, fake.editor);
    fake.editor.select(7, 8);
    fake.editor.surround("$", "$");
    expect(fake.snippetInsert).toHaveBeenLastCalledWith("<m>${1:x}</m>$0", {
      adjustWhitespace: false,
    });
    // The selection covers `$x$`, for the snippet to replace.
    expect(fake.editor.getSelection()).toEqual(new FakeRange(1, 8, 1, 11));

    const other = makeEditor("<p>Let |x be.</p>");
    registerMonacoTypingShortcuts(monaco, other.editor);
    other.editor.select(7, 8);
    other.editor.surround("<", ">");
    expect(other.snippetInsert).toHaveBeenLastCalledWith(
      "<$1>${2:x}</${1/[\\s>].*//}>$0",
      { adjustWhitespace: false },
    );
    expect(other.editor.trigger).toHaveBeenCalledWith(
      "pretext-typing-shortcuts",
      "editor.action.triggerSuggest",
      {},
    );
  });

  it("adds an action that wraps the selection", () => {
    const fake = makeEditor("<p>Let |x be.</p>");
    registerMonacoTypingShortcuts(monaco, fake.editor);
    const action = fake.actions.find(
      ({ id }) => id === "pretext.typingShortcuts.wrapSelection",
    );
    fake.editor.select(7, 8);
    action.run(fake.editor, { element: "em" });
    expect(fake.snippetInsert).toHaveBeenLastCalledWith("<em>${1:x}</em>$0", {
      adjustWhitespace: false,
    });
  });

  it("removes everything on dispose", () => {
    const fake = makeEditor("<p>|</p>");
    const registration = registerMonacoTypingShortcuts(monaco, fake.editor);
    registration.dispose();
    expect(fake.actions).toHaveLength(0);
    for (const ch of "$x$") fake.editor.type(ch);
    expect(fake.text).toBe("<p>$x$|</p>");
  });
});
