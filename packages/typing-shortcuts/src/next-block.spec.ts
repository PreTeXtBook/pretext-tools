import { describe, expect, it } from "vitest";
import { nextBlockEdit } from "./next-block";
import { applyEdit, doc, editor, show } from "./spec-utils";

const next = (marked: string, eol?: string): string | null => {
  const { source, caret } = doc(marked);
  const edit = nextBlockEdit(source, caret, eol);
  return edit && show(applyEdit(source, edit));
};

const lines = (...parts: string[]) => parts.join("\n");

describe("nextBlockEdit: list items", () => {
  it("starts the next item with the empty paragraph, inline", () => {
    expect(
      next(lines("<ul>", "  <li><p>One.</p>", "  <p>|</p></li>", "</ul>")),
    ).toBe(
      lines("<ul>", "  <li><p>One.</p></li>", "  <li><p>|</p></li>", "</ul>"),
    );
  });

  it("starts the next item in block layout", () => {
    expect(
      next(
        lines(
          "<ul>",
          "  <li>",
          "    <p>",
          "      One.",
          "    </p>",
          "    <p>",
          "      |",
          "    </p>",
          "  </li>",
          "</ul>",
        ),
      ),
    ).toBe(
      lines(
        "<ul>",
        "  <li>",
        "    <p>",
        "      One.",
        "    </p>",
        "  </li>",
        "  <li>",
        "    <p>",
        "      |",
        "    </p>",
        "  </li>",
        "</ul>",
      ),
    );
  });

  it("moves what follows the empty paragraph into the new item", () => {
    expect(next("<ul><li><p>One.</p><p>|</p><p>Two.</p></li></ul>")).toBe(
      "<ul><li><p>One.</p></li>\n<li><p>|</p><p>Two.</p></li></ul>",
    );
  });

  it("leaves the list from an empty last item, inside the paragraph holding it", () => {
    expect(
      next(
        lines(
          "<p>",
          "  Intro:",
          "  <ul>",
          "    <li><p>One.</p></li>",
          "    <li><p>|</p></li>",
          "  </ul>",
          "</p>",
        ),
      ),
    ).toBe(
      lines(
        "<p>",
        "  Intro:",
        "  <ul>",
        "    <li><p>One.</p></li>",
        "  </ul>",
        "  |",
        "</p>",
      ),
    );
  });

  it("leaves the list from an empty item with no paragraph", () => {
    expect(next("<p>Intro: <ol><li>One.</li><li>|</li></ol></p>")).toBe(
      "<p>Intro: <ol><li>One.</li></ol>\n|\n</p>",
    );
  });

  it("removes a list whose only item is empty", () => {
    expect(
      next(
        lines("<p>", "  Intro:", "  <ul>", "    <li>|</li>", "  </ul>", "</p>"),
      ),
    ).toBe(lines("<p>", "  Intro:", "  |", "</p>"));
  });

  it("does nothing in an empty item that isn't the last", () => {
    expect(next("<ul><li><p>|</p></li><li>Two.</li></ul>")).toBeNull();
  });
});

describe("nextBlockEdit: other blocks", () => {
  it("steps out of a statement, leaving the next element to the author", () => {
    expect(
      next(
        lines(
          "<theorem>",
          "  <statement>",
          "    <p>",
          "      One.",
          "    </p>",
          "    <p>",
          "      |",
          "    </p>",
          "  </statement>",
          "</theorem>",
        ),
      ),
    ).toBe(
      lines(
        "<theorem>",
        "  <statement>",
        "    <p>",
        "      One.",
        "    </p>",
        "  </statement>",
        "  |",
        "</theorem>",
      ),
    );
  });

  it("steps out of an inline block, moving what follows to its own line", () => {
    expect(
      next("<example><statement><p>One.</p><p>|</p></statement></example>"),
    ).toBe("<example><statement><p>One.</p></statement>\n|\n</example>");
    expect(next("<proof><p>One.</p><p>|</p></proof>")).toBe(
      "<proof><p>One.</p></proof>\n|",
    );
  });

  it("preserves CRLF line endings", () => {
    expect(
      next("<proof>\r\n  <p>One.</p>\r\n  <p>|</p>\r\n</proof>\r\n", "\r\n"),
    ).toBe("<proof>\r\n  <p>One.</p>\r\n</proof>\r\n|\r\n");
  });

  it("never leaves a block empty", () => {
    expect(next("<statement>\n  <p>|</p>\n</statement>")).toBeNull();
  });

  it("does nothing when the empty paragraph isn't the block's last child", () => {
    expect(next("<proof><p>One.</p><p>|</p><p>Two.</p></proof>")).toBeNull();
  });

  it("does nothing in a division", () => {
    expect(next("<section><p>One.</p><p>|</p></section>")).toBeNull();
    expect(next("<subsection><p>One.</p><p>|</p></subsection>")).toBeNull();
  });

  it("does nothing outside an empty paragraph or item", () => {
    expect(next("<proof><p>One.</p><p>Two|</p></proof>")).toBeNull();
    expect(next("<proof><p>One.</p><p><m>|</m></p></proof>")).toBeNull();
    expect(
      next("<theorem><statement><p>One.</p></statement>|</theorem>"),
    ).toBeNull();
  });
});

describe("TypingShortcuts: moving on from an empty paragraph", () => {
  it("Enter, Enter, Enter in a list item's paragraph starts the next item", () => {
    expect(
      editor("<ul>\n  <li><p>One.|</p></li>\n</ul>").type("\n", "\n", "\n")
        .text,
    ).toBe("<ul>\n  <li><p>One.</p></li>\n  <li><p>|</p></li>\n</ul>");
  });

  it("a fourth Enter leaves the list", () => {
    expect(
      editor("<p>\n  <ul>\n    <li><p>One.|</p></li>\n  </ul>\n</p>").type(
        "\n",
        "\n",
        "\n",
        "\n",
      ).text,
    ).toBe("<p>\n  <ul>\n    <li><p>One.</p></li>\n  </ul>\n  |\n</p>");
  });

  it("Enter, Enter, Enter in a statement steps out of it", () => {
    expect(
      editor(
        "<theorem>\n  <statement>\n    <p>One.|</p>\n  </statement>\n</theorem>",
      ).type("\n", "\n", "\n").text,
    ).toBe(
      "<theorem>\n  <statement>\n    <p>One.</p>\n  </statement>\n  |\n</theorem>",
    );
  });

  it("an Enter after the caret has moved is an ordinary Enter", () => {
    const e = editor("<proof><p>One.|</p></proof>").type("\n", "\n");
    expect(e.text).toBe("<proof><p>One.</p>\n<p>|</p></proof>");
    e.moveTo(e.doc.caret - 1).type("\n");
    expect(e.lastEdit).toBeNull();
  });

  it("an Enter after something else was typed is an ordinary Enter", () => {
    const e = editor("<proof><p>One.|</p></proof>").type("\n", "\n", "a");
    e.moveTo(e.doc.caret - 1);
    e.type("\n");
    expect(e.lastEdit).toBeNull();
  });

  it("works when the paragraph edit's own change event comes back, as in VS Code", () => {
    const e = editor("<proof><p>One.|</p></proof>").type("\n", "\n");
    // Undo what the helper told the session, then replay the edit's change
    // the way VS Code reports it.
    e.shortcuts.reset();
    const split = e.lastEdit!;
    const before = "<proof><p>One.\n\n</p></proof>";
    e.shortcuts.newParagraph(before, 14, 14); // the same split, remembered
    e.change(e.doc, [
      {
        rangeOffset: split.start,
        rangeLength: split.end - split.start,
        text: split.text,
      },
    ]);
    expect(e.lastEdit).toBeNull();
    e.type("\n");
    expect(e.text).toBe("<proof><p>One.</p></proof>\n|");
  });

  it("a double Enter in an empty paragraph moves on, even with no shortcut before it", () => {
    expect(
      editor("<proof><p>One.</p><p>|</p></proof>").type("\n", "\n").text,
    ).toBe("<proof><p>One.</p></proof>\n|");
  });

  it("a double Enter in an empty list item leaves the list", () => {
    expect(
      editor("<p><ul><li>One.</li><li>|</li></ul></p>").type("\n", "\n").text,
    ).toBe("<p><ul><li>One.</li></ul>\n|\n</p>");
  });

  it("Shift+Enter in an empty paragraph moves on", () => {
    const e = editor("<ul><li><p>One.</p><p>|</p></li></ul>");
    expect(e.shiftEnter()).not.toBeNull();
    expect(e.text).toBe("<ul><li><p>One.</p></li>\n<li><p>|</p></li></ul>");
    expect(e.shiftEnter()).not.toBeNull();
    expect(e.text).toBe("<ul><li><p>One.</p></li></ul>\n|");
  });

  it("Shift+Enter, Shift+Enter, Shift+Enter climbs the same ladder", () => {
    const e = editor("<p><ul><li><p>One.|</p></li></ul></p>");
    e.shiftEnter();
    e.shiftEnter();
    e.shiftEnter();
    expect(e.text).toBe("<p><ul><li><p>One.</p></li></ul>\n|\n</p>");
  });

  it("Shift+Enter in an empty list item still starts a paragraph in it", () => {
    const e = editor("<ul><li>One.</li><li>|</li></ul>");
    e.shiftEnter();
    expect(e.text).toContain("<li>\n");
    expect(e.text).toContain("<p>");
  });

  it("is off with the paragraph shortcuts", () => {
    expect(
      editor("<proof><p>One.</p><p>|</p></proof>", { paragraphs: false }).type(
        "\n",
        "\n",
      ).lastEdit,
    ).toBeNull();
  });
});
