import { describe, expect, it } from "vitest";
import { insertParagraphEdit, splitParagraphEdit } from "./paragraphs";
import { applyEdit, doc, show } from "./spec-utils";

const split = (marked: string): string | null => {
  const { source, caret } = doc(marked);
  const edit = splitParagraphEdit(source, caret);
  return edit && show(applyEdit(source, edit));
};

const insert = (marked: string, indentUnit = "  "): string | null => {
  const { source, caret } = doc(marked);
  const edit = insertParagraphEdit(source, caret, indentUnit);
  return edit && show(applyEdit(source, edit));
};

const lines = (...parts: string[]) => parts.join("\n");

describe("splitParagraphEdit", () => {
  it("ends a block paragraph and opens an empty one after it", () => {
    expect(split(lines("  <p>", "    Some text.", "", "    |", "  </p>"))).toBe(
      lines("  <p>", "    Some text.", "  </p>", "  <p>", "    |", "  </p>"),
    );
  });

  it("moves the text after the caret into the new block paragraph", () => {
    expect(split(lines("<p>", "  One. |Two.", "</p>"))).toBe(
      lines("<p>", "  One.", "</p>", "<p>", "  |Two.", "</p>"),
    );
  });

  it("keeps an inline paragraph inline", () => {
    expect(split("<p>One.|</p>")).toBe("<p>One.</p>\n<p>|</p>");
    expect(split("<p>One. |Two.</p>")).toBe("<p>One.</p>\n<p>|Two.</p>");
  });

  it("absorbs the blank lines a double Enter leaves in an inline paragraph", () => {
    expect(split("  <p>One.\n\n|</p>")).toBe("  <p>One.</p>\n  <p>|</p>");
  });

  it("keeps the author's content indentation", () => {
    expect(split(lines("<p>", "One.", "|", "</p>"))).toBe(
      lines("<p>", "One.", "</p>", "<p>", "|", "</p>"),
    );
  });

  it("preserves CRLF line endings", () => {
    expect(split("<p>\r\n  One.\r\n  |\r\n</p>")).toBe(
      "<p>\r\n  One.\r\n</p>\r\n<p>\r\n  |\r\n</p>",
    );
  });

  it("uses the line break it's given, for text that has none yet", () => {
    const { source, caret } = doc("<p>One.|</p>");
    const edit = splitParagraphEdit(source, caret, "\r\n")!;
    expect(show(applyEdit(source, edit))).toBe("<p>One.</p>\r\n<p>|</p>");
  });

  it("does nothing when nothing precedes the caret in the paragraph", () => {
    expect(split("<p>\n  |\n</p>")).toBeNull();
    expect(split("<p>|One.</p>")).toBeNull();
  });

  it("does nothing inside markup within a paragraph, or outside one", () => {
    expect(split("<p>One <em>two|</em></p>")).toBeNull();
    expect(split("<p>One <m>x|</m></p>")).toBeNull();
    expect(split("<section>|</section>")).toBeNull();
  });
});

describe("insertParagraphEdit", () => {
  it("fills a blank, indented line", () => {
    expect(insert(lines("<section>", "  |", "</section>"))).toBe(
      lines("<section>", "  <p>", "    |", "  </p>", "</section>"),
    );
  });

  it("indents one level past the parent on an unindented blank line", () => {
    expect(insert(lines("  <statement>", "|", "  </statement>"))).toBe(
      lines(
        "  <statement>",
        "    <p>",
        "      |",
        "    </p>",
        "  </statement>",
      ),
    );
  });

  it("starts on the next line after content", () => {
    expect(
      insert(lines("<section>", "  <title>Intro</title>|", "</section>")),
    ).toBe(
      lines(
        "<section>",
        "  <title>Intro</title>",
        "  <p>",
        "    |",
        "  </p>",
        "</section>",
      ),
    );
  });

  it("moves content after the caret below the new paragraph", () => {
    expect(insert(lines("<section>", "  |<p>Old.</p>", "</section>"))).toBe(
      lines(
        "<section>",
        "  <p>",
        "    |",
        "  </p>",
        "  <p>Old.</p>",
        "</section>",
      ),
    );
  });

  it("uses the editor's indent unit", () => {
    expect(insert("<section>\n\t|\n</section>", "\t")).toBe(
      "<section>\n\t<p>\n\t\t|\n\t</p>\n</section>",
    );
  });

  it("uses the line break it's given", () => {
    const { source, caret } = doc("<section>|</section>");
    const edit = insertParagraphEdit(source, caret, "  ", "\r\n")!;
    expect(show(applyEdit(source, edit))).toBe(
      "<section>\r\n<p>\r\n  |\r\n</p>\r\n</section>",
    );
  });

  it("does nothing inside a paragraph, math, a title, or a list", () => {
    expect(insert("<p>a <em>b|</em></p>")).toBeNull();
    expect(insert("<md>\n  |\n</md>")).toBeNull();
    expect(insert("<title>A|</title>")).toBeNull();
    expect(insert("<ol>\n  |\n</ol>")).toBeNull();
  });
});
