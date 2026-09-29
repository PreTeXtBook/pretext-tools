import { describe, expect, it } from "vitest";
import { TypingShortcuts, typedInput } from "./session";
import { applyEdit, doc, show, type, type Doc } from "./spec-utils";
import type { TextChange, TypingShortcutsOptions } from "./types";

/**
 * Drives a {@link TypingShortcuts} like an editor adapter does: each keystroke
 * produces a change event, and any shortcut edit is applied (after resetting
 * the session, as the adapters do for their own edits).
 */
const editor = (marked: string, options?: TypingShortcutsOptions) => {
  const shortcuts = new TypingShortcuts(options);
  let current = doc(marked);
  const fire = (next: Doc, changes: TextChange[]) => {
    const edit = shortcuts.afterChange(next.source, changes);
    current = edit ? applyEdit(next.source, edit) : next;
    if (edit) shortcuts.reset();
  };
  return {
    type(...keys: string[]) {
      for (const key of keys) {
        const { doc: next, changes } = type(current, key);
        fire(next, changes);
      }
      return this;
    },
    /** Replay a raw change event. */
    change(next: Doc, changes: TextChange[]) {
      fire(next, changes);
      return this;
    },
    moveTo(caret: number) {
      current = { ...current, caret };
      return this;
    },
    shiftEnter() {
      const edit = shortcuts.newParagraph(
        current.source,
        current.caret,
        current.caret,
      );
      if (edit) current = applyEdit(current.source, edit);
      return edit;
    },
    get text() {
      return show(current);
    },
    get doc() {
      return current;
    },
    shortcuts,
  };
};

const lines = (...parts: string[]) => parts.join("\n");

describe("typedInput", () => {
  it("recognizes a typed character", () => {
    expect(typedInput([{ rangeOffset: 4, rangeLength: 0, text: "$" }])).toEqual(
      {
        start: 4,
        end: 5,
        text: "$",
        before: 4,
        enter: false,
      },
    );
  });

  it("recognizes an Enter with indentation, and one that splits a tag pair", () => {
    expect(
      typedInput([{ rangeOffset: 4, rangeLength: 0, text: "\n  " }])?.enter,
    ).toBe(true);
    expect(
      typedInput([{ rangeOffset: 4, rangeLength: 0, text: "\r\n  " }])?.enter,
    ).toBe(true);
    expect(
      typedInput([{ rangeOffset: 4, rangeLength: 0, text: "\n  \n" }])?.enter,
    ).toBe(true);
  });

  it("maps the typed text past a trim of the line before it", () => {
    // Enter at the end of "  " (offset 10–12) with that auto-indent trimmed.
    expect(
      typedInput([
        { rangeOffset: 12, rangeLength: 0, text: "\n  " },
        { rangeOffset: 10, rangeLength: 2, text: "" },
      ]),
    ).toMatchObject({ start: 10, end: 13, before: 12, enter: true });
  });

  it("rejects pastes, replacements and multiple carets", () => {
    expect(
      typedInput([{ rangeOffset: 0, rangeLength: 0, text: "ab" }]),
    ).toBeNull();
    expect(
      typedInput([{ rangeOffset: 0, rangeLength: 1, text: "a" }]),
    ).toBeNull();
    expect(
      typedInput([
        { rangeOffset: 9, rangeLength: 0, text: "a" },
        { rangeOffset: 3, rangeLength: 0, text: "a" },
      ]),
    ).toBeNull();
    expect(
      typedInput([{ rangeOffset: 0, rangeLength: 3, text: "" }]),
    ).toBeNull();
  });
});

describe("TypingShortcuts", () => {
  describe("math and escapes", () => {
    it("converts $x$ as the closing $ is typed", () => {
      expect(editor("<p>Let |</p>").type("$", "x", "$").text).toBe(
        "<p>Let <m>x</m>|</p>",
      );
    });

    it("converts $$x$$ to display math", () => {
      expect(editor("<p>|</p>").type("$", "$", "x", "$", "$").text).toBe(
        "<p><md>x</md>|</p>",
      );
    });

    it("escapes < and & in text and uses \\lt in math", () => {
      expect(editor("<p>|</p>").type("a", " ", "<", " ", "b").text).toBe(
        "<p>a &lt; b|</p>",
      );
      expect(editor("<p>|</p>").type("A", " ", "&", " ").text).toBe(
        "<p>A &amp; |</p>",
      );
      expect(editor("<p><m>|</m></p>").type("a", " ", "<", " ", "b").text).toBe(
        "<p><m>a \\lt b|</m></p>",
      );
    });

    it("leaves a < that starts a tag", () => {
      expect(editor("<p>|</p>").type("<", "e", "m").text).toBe("<p><em|</p>");
    });
  });

  describe("paragraphs", () => {
    const block = lines(
      "<section>",
      "  <p>",
      "    One.|",
      "  </p>",
      "</section>",
    );
    const split = lines(
      "<section>",
      "  <p>",
      "    One.",
      "  </p>",
      "  <p>",
      "    |",
      "  </p>",
      "</section>",
    );

    it("splits a paragraph on a double Enter", () => {
      expect(editor(block).type("\n", "\n").text).toBe(split);
    });

    it("splits when the second Enter also trims the auto-indented line", () => {
      // What VS Code and Monaco emit: the Enter, plus a deletion of the
      // indentation the first Enter left on the now-blank line.
      const e = editor(block).type("\n");
      const { source, caret } = e.doc;
      const lineStart = source.lastIndexOf("\n", caret - 1) + 1;
      const next = {
        source: source.slice(0, lineStart) + "\n    " + source.slice(caret),
        caret: lineStart + 5,
      };
      e.change(next, [
        { rangeOffset: caret, rangeLength: 0, text: "\n    " },
        { rangeOffset: lineStart, rangeLength: caret - lineStart, text: "" },
      ]);
      expect(e.text).toBe(split);
    });

    it("splits an inline paragraph mid-text", () => {
      expect(editor("<p>One. |Two.</p>").type("\n", "\n").text).toBe(
        "<p>One.</p>\n<p>|Two.</p>",
      );
    });

    it("splits after an Enter that opened a tag pair onto three lines", () => {
      // Monaco's XML mode: Enter in `<p>One.|</p>`… is just a newline here,
      // but between `<p>` and `</p>` it puts the closing tag on its own line.
      const e = editor("<p>One.|</p>");
      const first = {
        source: "<p>One.\n  \n</p>",
        caret: "<p>One.\n  ".length,
      };
      e.change(first, [{ rangeOffset: 7, rangeLength: 0, text: "\n  \n" }]);
      e.type("\n");
      expect(e.text).toBe("<p>One.</p>\n<p>|</p>");
    });

    it("does not split on a single Enter at the start of a line", () => {
      const e = editor(lines("<p>", "  One.", "  |Two.", "</p>")).type("\n");
      expect(e.text).toBe(lines("<p>", "  One.", "  ", "  |Two.", "</p>"));
    });

    it("does not split when anything is typed between the Enters", () => {
      expect(editor("<p>One.|</p>").type("\n", "a", "\n").text).toBe(
        "<p>One.\na\n|</p>",
      );
    });

    it("does not split after the caret moved away", () => {
      const e = editor("<p>One. Two.|</p>").type("\n");
      e.moveTo(4).type("\n");
      expect(e.text).toBe("<p>O\n|ne. Two.\n</p>");
    });

    it("forgets the first Enter after reset()", () => {
      const e = editor("<p>One.|</p>").type("\n");
      e.shortcuts.reset();
      expect(e.type("\n").text).toBe("<p>One.\n\n|</p>");
    });

    it("never splits on a double Enter outside a paragraph", () => {
      expect(editor("<section>|</section>").type("\n", "\n").text).toBe(
        "<section>\n\n|</section>",
      );
    });

    it("splits the paragraph or starts one on Shift+Enter", () => {
      const inside = editor("<p>One. |Two.</p>");
      expect(inside.shiftEnter()).not.toBeNull();
      expect(inside.text).toBe("<p>One.</p>\n<p>|Two.</p>");

      const outside = editor(lines("<section>", "  |", "</section>"));
      expect(outside.shiftEnter()).not.toBeNull();
      expect(outside.text).toBe(
        lines("<section>", "  <p>", "    |", "  </p>", "</section>"),
      );
    });

    it("gives Shift+Enter back to the editor where it doesn't apply", () => {
      expect(editor("<p>One <em>two|</em></p>").shiftEnter()).toBeNull();
      expect(editor("<p>|One.</p>").shiftEnter()).toBeNull();
      const shortcuts = new TypingShortcuts();
      expect(shortcuts.newParagraph("<section></section>", 9, 10)).toBeNull();
    });
  });

  describe("environments", () => {
    it("expands `theorem:` + Enter", () => {
      const e = editor(lines("<section>", "  |", "</section>"));
      e.type(..."theorem:".split(""), "\n");
      expect(e.text).toBe(
        lines(
          "<section>",
          '  <theorem xml:id="thm-|">',
          "\t<statement>",
          "\t\t<p>",
          "\t\t\t",
          "\t\t</p>",
          "\t</statement>",
          "</theorem>",
          "</section>",
        ),
      );
    });
  });

  describe("options", () => {
    it("turns each shortcut off independently", () => {
      expect(
        editor("<p>|</p>", { mathDelimiters: false }).type("$", "x", "$").text,
      ).toBe("<p>$x$|</p>");
      expect(editor("<p>|</p>", { escapes: false }).type("<", " ").text).toBe(
        "<p>< |</p>",
      );
      expect(
        editor("<p>One.|</p>", { paragraphs: false }).type("\n", "\n").text,
      ).toBe("<p>One.\n\n|</p>");
      expect(
        editor("<section>\n|</section>", { environments: false }).type(
          ..."proof:".split(""),
          "\n",
        ).text,
      ).toBe("<section>\nproof:\n|</section>");
    });

    it("ignores a change that didn't end at the caret", () => {
      const shortcuts = new TypingShortcuts();
      const source = "<p>$x$ and more</p>";
      const changes = [{ rangeOffset: 5, rangeLength: 0, text: "$" }];
      expect(shortcuts.afterChange(source, changes, { caret: 18 })).toBeNull();
      expect(
        shortcuts.afterChange(source, changes, { caret: 6 }),
      ).not.toBeNull();
    });
  });
});
