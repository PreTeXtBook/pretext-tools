import { describe, expect, it } from "vitest";
import { surroundInput, TypingShortcuts } from "./session";
import { snippetToPlainText } from "./snippets";
import type {
  EditorState,
  ShortcutEdit,
  TypingShortcutsOptions,
} from "./types";
import { shiftTabStops, wrapSelectionEdit } from "./wrap";

const lines = (...parts: string[]) => parts.join("\n");

/** Parse a document with `⟦…⟧` marking the selection. */
const selection = (marked: string) => {
  const start = marked.indexOf("⟦");
  const end = marked.indexOf("⟧") - 1;
  if (start === -1 || end < start) throw new Error(`no selection in ${marked}`);
  return { source: marked.replace("⟦", "").replace("⟧", ""), start, end };
};

/**
 * Insert a snippet edit, flattened, returning the document with `|` at the
 * caret (the first tab stop). Wrap edits are indented as they are to end up.
 */
const insert = (source: string, edit: ShortcutEdit): string => {
  expect(edit.keepWhitespace).toBe(true);
  const { text, caret } = snippetToPlainText(edit.text);
  return (
    source.slice(0, edit.start) +
    text.slice(0, caret) +
    "|" +
    text.slice(caret) +
    source.slice(edit.end)
  );
};

const STATE: EditorState = { indentUnit: "  " };

/** Wrap the `⟦…⟧` selection in `element`, returning the edit and the result. */
const wrap = (marked: string, element: string | null) => {
  const { source, start, end } = selection(marked);
  const edit = wrapSelectionEdit(source, start, end, element, STATE);
  return edit && { edit, text: insert(source, edit) };
};

describe("wrapSelectionEdit", () => {
  it("wraps a selection in an element, keeping it selected", () => {
    const result = wrap("<p>Let ⟦x^2⟧ be positive.</p>", "m");
    expect(result?.edit).toMatchObject({
      kind: "wrap",
      start: 7,
      end: 10,
      snippet: true,
      text: "<m>${1:x^2}</m>$0",
    });
    expect(result?.edit.suggest).toBeUndefined();
    expect(result?.text).toBe("<p>Let <m>|x^2</m> be positive.</p>");
  });

  it("escapes the selection for the snippet engine", () => {
    const result = wrap("<p>⟦\\frac{a}{b} = $5⟧</p>", "m");
    expect(result?.edit.text).toBe("<m>${1:\\\\frac{a\\}{b\\} = \\$5}</m>$0");
    expect(result?.text).toBe("<p><m>|\\frac{a}{b} = $5</m></p>");
  });

  it("leaves whitespace at either end of the selection outside", () => {
    expect(wrap("<p>Very⟦ important ⟧point.</p>", "em")?.text).toBe(
      "<p>Very <em>|important</em> point.</p>",
    );
  });

  it("uses the element's completion snippet where it marks the selection", () => {
    expect(wrap("<p>See ⟦the docs⟧.</p>", "url")?.edit.text).toBe(
      '<url href="$1">${2:the docs}</url>$0',
    );
    // `<me>`'s snippet makes an `<md>`; text after its last tag is dropped.
    expect(wrap("<p>⟦x = 1⟧</p>", "me")?.edit.text).toBe(
      "<md>\n  ${1:x = 1}\n</md>$0",
    );
  });

  it("wraps lines in a block element on lines of its own", () => {
    const result = wrap(
      lines(
        "<section>",
        "  ⟦Some text",
        "    indented more",
        "  and back.⟧",
        "</section>",
      ),
      "p",
    );
    expect(result?.edit.text).toBe(
      "<p>\n    ${1:Some text\n      indented more\n    and back.}$0\n  </p>",
    );
    expect(result?.text).toBe(
      lines(
        "<section>",
        "  <p>",
        "    |Some text",
        "      indented more",
        "    and back.",
        "  </p>",
        "</section>",
      ),
    );
  });

  it("re-indents whole lines selected from the start of the line", () => {
    expect(
      wrap(lines("<section>", "⟦  One.", "  Two.", "⟧</section>"), "blockquote")
        ?.text,
    ).toBe(
      lines(
        "<section>",
        "  <blockquote>",
        "    <p>",
        "      |One.",
        "      Two.",
        "    </p>",
        "  </blockquote>",
        "</section>",
      ),
    );
  });

  it("wraps in any element by name, on lines of its own around lines", () => {
    expect(wrap("<p>It is ⟦5 m⟧ long.</p>", "quantity")?.edit.text).toBe(
      "<quantity>${1:5 m}</quantity>$0",
    );
    expect(
      wrap(
        lines("<section>", "  ⟦<p>One.</p>", "  <p>Two.</p>⟧", "</section>"),
        "aside",
      )?.text,
    ).toBe(
      lines(
        "<section>",
        "  <aside>",
        "    |<p>One.</p>",
        "    <p>Two.</p>",
        "  </aside>",
        "</section>",
      ),
    );
  });

  it("names the element by typing for `null`, with completions", () => {
    const result = wrap("<p>Let ⟦x⟧ be.</p>", null);
    expect(result?.edit).toMatchObject({
      text: "<$1>${2:x}</${1/[\\s>].*//}>$0",
      suggest: true,
    });
    expect(result?.text).toBe("<p>Let <|>x</> be.</p>");
    expect(
      wrap(
        lines("<section>", "  ⟦<p>One.</p>", "  <p>Two.</p>⟧", "</section>"),
        null,
      )?.edit.text,
    ).toBe(
      "<$1>\n    ${2:<p>One.</p>\n    <p>Two.</p>}\n  </${1/[\\s>].*//}>$0",
    );
  });

  it("wraps nothing in an empty element", () => {
    expect(wrap("<p>a ⟦⟧b</p>", "em")?.edit.text).toBe("<em>$1</em>$0");
  });

  it("refuses selections that would break the markup", () => {
    expect(wrap("<p>a ⟦b</p><p>c⟧ d</p>", "em")).toBeNull();
    expect(wrap("<p>a ⟦b <em>c⟧ d</em></p>", "em")).toBeNull();
    expect(wrap('<p ⟦class⟧="x">a</p>', "em")).toBeNull();
    expect(wrap("<p>a <!-- ⟦b⟧ --></p>", "em")).toBeNull();
    expect(wrap("<p>⟦a⟧</p>", "em class")).toBeNull();
  });

  it("accepts selections of whole elements", () => {
    expect(wrap("<p>a ⟦<em>b</em> c⟧ d</p>", "q")?.text).toBe(
      "<p>a <q>|<em>b</em> c</q> d</p>",
    );
  });
});

describe("shiftTabStops", () => {
  it("numbers every tab stop but $0 one up, mirrors and escapes aside", () => {
    expect(shiftTabStops('<a b="$1">${2:x}${1/a/b/}\\$1$0')).toBe(
      '<a b="$2">${3:x}${2/a/b/}\\$1$0',
    );
  });
});

describe("surroundInput", () => {
  it("recognizes a character inserted at each end of a selection", () => {
    // VS Code lists the later change first.
    expect(
      surroundInput([
        { rangeOffset: 9, rangeLength: 0, text: "$" },
        { rangeOffset: 4, rangeLength: 0, text: "$" },
      ]),
    ).toEqual({ open: "$", close: "$", start: 4, end: 11 });
  });

  it("rejects anything else", () => {
    expect(
      surroundInput([{ rangeOffset: 4, rangeLength: 0, text: "$" }]),
    ).toBeNull();
    expect(
      surroundInput([
        { rangeOffset: 4, rangeLength: 0, text: "$$" },
        { rangeOffset: 9, rangeLength: 0, text: "$$" },
      ]),
    ).toBeNull();
    expect(
      surroundInput([
        { rangeOffset: 4, rangeLength: 2, text: "$" },
        { rangeOffset: 9, rangeLength: 0, text: "$" },
      ]),
    ).toBeNull();
  });
});

describe("TypingShortcuts: wrapping a selection", () => {
  /**
   * Type `open` over the `⟦…⟧` selection with the editor's auto-surround
   * (which adds `close` after it), and return what the shortcut makes of it.
   */
  const surround = (
    marked: string,
    open: string,
    close = open,
    options?: TypingShortcutsOptions,
    state: EditorState = STATE,
  ) => {
    const { source, start, end } = selection(marked);
    const surrounded =
      source.slice(0, start) +
      open +
      source.slice(start, end) +
      close +
      source.slice(end);
    const edit = new TypingShortcuts(options).afterChange(
      surrounded,
      [
        { rangeOffset: end, rangeLength: 0, text: close },
        { rangeOffset: start, rangeLength: 0, text: open },
      ],
      state,
    );
    return edit && { edit, text: insert(surrounded, edit) };
  };

  it.each([
    ["$", "m"],
    ["*", "em"],
    ["`", "c"],
    ['"', "q"],
  ])("wraps the selection typed over with %s in <%s>", (open, element) => {
    expect(surround("<p>Let ⟦x⟧ be.</p>", open)?.text).toBe(
      `<p>Let <${element}>|x</${element}> be.</p>`,
    );
  });

  it("wraps it in an element named by typing for <", () => {
    const result = surround("<p>Let ⟦x⟧ be.</p>", "<", ">");
    expect(result?.edit.suggest).toBe(true);
    expect(result?.text).toBe("<p>Let <|>x</> be.</p>");
  });

  it("keeps whitespace in the selection outside the element", () => {
    expect(surround("<p>Very⟦ important ⟧point.</p>", "*")?.text).toBe(
      "<p>Very <em>|important</em> point.</p>",
    );
  });

  it("wraps selected lines in an element on lines of its own", () => {
    expect(
      surround(
        lines("<section>", "⟦  <p>One.</p>", "  <p>Two.</p>", "⟧</section>"),
        "<",
        ">",
      )?.text,
    ).toBe(
      lines(
        "<section>",
        "  <|>",
        "    <p>One.</p>",
        "    <p>Two.</p>",
        "  </>",
        "</section>",
      ),
    );
  });

  it("leaves other surrounds, and mismatched pairs, alone", () => {
    expect(surround("<p>Let ⟦x⟧ be.</p>", "(", ")")).toBeNull();
    expect(surround("<p>Let ⟦x⟧ be.</p>", "<", "<")).toBeNull();
  });

  it("does nothing with more than one selection, or when turned off", () => {
    expect(
      surround("<p>Let ⟦x⟧ be.</p>", "$", "$", undefined, { selections: 2 }),
    ).toBeNull();
    expect(
      surround("<p>Let ⟦x⟧ be.</p>", "$", "$", { wrapSelection: false }),
    ).toBeNull();
  });

  it("ignores a surround the caret isn't in", () => {
    expect(
      surround("<p>Let ⟦x⟧ be.</p>", "$", "$", undefined, { caret: 0 }),
    ).toBeNull();
  });
});
