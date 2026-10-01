import { describe, expect, it } from "vitest";
import { editor } from "./spec-utils";

const lines = (...parts: string[]) => parts.join("\n");

const block = lines("<p>", "  Consider:", "  |", "</p>");

describe("starting a list", () => {
  it("turns `- ` on a line of its own in a <p> into a <ul>", () => {
    expect(editor(block).typeText("- ").text).toBe(
      lines(
        "<p>",
        "  Consider:",
        "  <ul>",
        "    <li>|</li>",
        "  </ul>",
        "</p>",
      ),
    );
    expect(editor(block).typeText("* ").text).toContain("<ul>");
  });

  it("turns `1. ` into an <ol>, and other markers into its marker attribute", () => {
    expect(editor(block).typeText("1. ").text).toContain("  <ol>\n");
    expect(editor(block).typeText("3. ").text).toContain("  <ol>\n");
    expect(editor(block).typeText("1) ").text).toContain('<ol marker="1)">');
    expect(editor(block).typeText("a. ").text).toContain('<ol marker="a.">');
    expect(editor(block).typeText("(i) ").text).toContain('<ol marker="(i)">');
    expect(editor(block).typeText("A) ").text).toContain('<ol marker="A)">');
  });

  it("starts a list right after <p>, moving </p> below it", () => {
    expect(editor("<p>|</p>").typeText("- ").text).toBe(
      lines("<p>", "  <ul>", "    <li>|</li>", "  </ul>", "</p>"),
    );
  });

  it("starts a list on a new line of an inline paragraph", () => {
    expect(editor("<p>We have\n|</p>").typeText("1. ").text).toBe(
      lines("<p>We have", "<ol>", "  <li>|</li>", "</ol>", "</p>"),
    );
  });

  it("makes plain text after the marker the first item", () => {
    const e = editor(lines("<p>", "  |first thing", "</p>")).typeText("- ");
    expect(e.text).toBe(
      lines("<p>", "  <ul>", "    <li>|first thing</li>", "  </ul>", "</p>"),
    );
  });

  it("leaves markers that aren't at the start of a line alone", () => {
    expect(editor("<p>a |</p>").typeText("- b").text).toBe("<p>a - b|</p>");
    expect(editor(block).typeText("2019. ").text).toContain("2019. |");
    expect(editor("<p><em>|</em></p>").typeText("- ").text).toBe(
      "<p><em>- |</em></p>",
    );
    expect(editor("<section>\n|</section>").typeText("- ").text).toBe(
      "<section>\n- |</section>",
    );
  });
});

describe("the next item", () => {
  const list = lines("<p>", "  <ul>", "    <li>|</li>", "  </ul>", "</p>");

  it("starts on a marker at the start of a line in an <li>", () => {
    expect(editor(list).typeText("first\n- second").text).toBe(
      lines(
        "<p>",
        "  <ul>",
        "    <li>first</li>",
        "    <li>second|</li>",
        "  </ul>",
        "</p>",
      ),
    );
  });

  it("starts on any marker, numbered or not", () => {
    expect(editor(list).typeText("one\n2. two").text).toContain(
      "<li>one</li>\n    <li>two|</li>",
    );
  });

  it("leaves a marker at the very start of an empty item alone", () => {
    expect(editor(list).typeText("- ").text).toContain("<li>- |</li>");
  });
});

describe("paragraphs in list items", () => {
  const list = lines("<p>", "  <ul>", "    <li>first|</li>", "  </ul>", "</p>");
  const promoted = lines(
    "<p>",
    "  <ul>",
    "    <li>",
    "      <p>first</p>",
    "      <p>|</p>",
    "    </li>",
    "  </ul>",
    "</p>",
  );

  it("splits an item's text into paragraphs on a double Enter", () => {
    expect(editor(list).type("\n", "\n").text).toBe(promoted);
  });

  it("splits an item's text into paragraphs on Shift+Enter", () => {
    const e = editor(list);
    e.shiftEnter();
    expect(e.text).toBe(promoted);
  });

  it("splits a paragraph inside an item as usual", () => {
    const e = editor(promoted).typeText("more");
    e.type("\n", "\n");
    expect(e.text).toContain("<p>more</p>\n      <p>|</p>");
  });

  it("starts the next item from an empty paragraph that ends an item", () => {
    expect(editor(promoted).typeText("- next").text).toBe(
      lines(
        "<p>",
        "  <ul>",
        "    <li>",
        "      <p>first</p>",
        "    </li>",
        "    <li>",
        "      next|",
        "    </li>",
        "  </ul>",
        "</p>",
      ),
    );
  });

  it("nests a list in a paragraph with text in it", () => {
    const e = editor(
      lines("<li>", "  <p>", "    Cases:", "    |", "  </p>", "</li>"),
    ).typeText("- ");
    expect(e.text).toContain("    Cases:\n    <ul>\n      <li>|</li>");
  });

  it("starts a paragraph between the paragraphs of an item on Shift+Enter", () => {
    const e = editor(
      lines(
        "<p><ul>",
        "  <li>",
        "    <p>a</p>",
        "    |",
        "  </li>",
        "</ul></p>",
      ),
    );
    expect(e.shiftEnter()).not.toBeNull();
    expect(e.text).toContain("    <p>a</p>\n    <p>\n      |\n    </p>");
  });
});

describe("options", () => {
  it("can be turned off", () => {
    expect(editor(block, { lists: false }).typeText("- ").text).toBe(
      lines("<p>", "  Consider:", "  - |", "</p>"),
    );
  });
});
