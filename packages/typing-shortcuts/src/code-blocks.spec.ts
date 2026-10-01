import { describe, expect, it } from "vitest";
import { editor } from "./spec-utils";

const lines = (...parts: string[]) => parts.join("\n");

describe("code blocks", () => {
  it("expands ```python + Enter into a <program>", () => {
    const e = editor(lines("<section>", "  |", "</section>"));
    e.typeText("```Python\n");
    expect(e.text).toBe(
      lines(
        "<section>",
        '  <program language="python">',
        "\t<code>",
        "\t\t|",
        "\t</code>",
        "</program>",
        "</section>",
      ),
    );
    expect(e.lastEdit).toMatchObject({ kind: "code-block", snippet: true });
  });

  it("expands a bare ``` + Enter into a <pre>", () => {
    const e = editor(lines("<section>", "|", "</section>"));
    e.typeText("```\n");
    expect(e.text).toBe(
      lines("<section>", "<pre>", "\t|", "</pre>", "</section>"),
    );
  });

  it("makes a <cd> inside a paragraph", () => {
    const e = editor(lines("<p>", "  Consider", "  |", "</p>"));
    e.typeText("```sh\n");
    expect(e.text).toBe(
      lines("<p>", "  Consider", "  <cd>", "\t|", "</cd>", "</p>"),
    );
  });

  it("needs the fence on a line of its own, in a place a block can go", () => {
    expect(editor("<p>|</p>").typeText("a ```\n").text).toBe("<p>a ```\n|</p>");
    expect(
      editor(lines("<p><em>", "|", "</em></p>")).typeText("```\n").text,
    ).toBe(lines("<p><em>", "```", "|", "</em></p>"));
    expect(editor(lines("<pre>", "|", "</pre>")).typeText("```\n").text).toBe(
      lines("<pre>", "```", "|", "</pre>"),
    );
  });

  it("can be turned off", () => {
    expect(
      editor(lines("<section>", "|", "</section>"), {
        codeBlocks: false,
      }).typeText("```\n").text,
    ).toBe(lines("<section>", "```", "|", "</section>"));
  });
});
