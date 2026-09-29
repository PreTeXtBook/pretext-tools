import { ELEMENTS } from "@pretextbook/completions";
import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_NAMES,
  environmentEdit,
  environmentSnippet,
} from "./environments";
import { doc, type } from "./spec-utils";

/** Type Enter at the caret and return the expansion it triggers. */
const enter = (marked: string) => {
  const { doc: after, changes } = type(doc(marked), "\n");
  const start = changes[0].rangeOffset;
  const edit = environmentEdit(
    after.source,
    start,
    start + changes[0].text.length,
  );
  return (
    edit && { ...edit, replaced: after.source.slice(edit.start, edit.end) }
  );
};

describe("environmentSnippet", () => {
  it("is the completion snippet, without a trailing newline", () => {
    expect(environmentSnippet("theorem")).toBe(
      ELEMENTS.theorem.insertText!.replace(/\n$/, ""),
    );
    expect(environmentSnippet("theorem")).toMatch(
      /^<theorem xml:id="thm-\$1">/,
    );
    expect(environmentSnippet("theorem")).toMatch(/<\/theorem>$/);
  });

  it("has a snippet for every listed environment", () => {
    for (const name of ENVIRONMENT_NAMES) {
      expect(environmentSnippet(name), name).toMatch(
        new RegExp(`^<${name}[ >]`),
      );
    }
  });

  it("has none for other elements", () => {
    expect(environmentSnippet("p")).toBeUndefined();
    expect(environmentSnippet("section")).toBeUndefined();
  });
});

describe("environmentEdit", () => {
  it("replaces `theorem:` and the Enter with the theorem snippet", () => {
    const edit = enter("<section>\n  theorem:|\n</section>");
    expect(edit).toMatchObject({
      kind: "environment",
      snippet: true,
      text: environmentSnippet("theorem"),
      replaced: "theorem:\n  ",
    });
  });

  it("accepts trailing spaces and a capitalized name", () => {
    expect(enter("<section>\n  Definition:  |\n</section>")?.text).toBe(
      environmentSnippet("definition"),
    );
  });

  it("ignores unknown names and lines with other text", () => {
    expect(enter("<section>\n  banana:|\n</section>")).toBeNull();
    expect(enter("<section>\n  A theorem:|\n</section>")).toBeNull();
    expect(enter("<section>\n  theorem:| more\n</section>")).toBeNull();
  });

  it("does not fire inside a paragraph or in non-block places", () => {
    expect(enter("<p>\n  theorem:|\n</p>")).toBeNull();
    expect(enter("<p>\n  <em>theorem:|</em>\n</p>")).toBeNull();
    expect(enter("<md>\n  theorem:|\n</md>")).toBeNull();
    expect(enter("<pre>\n  theorem:|\n</pre>")).toBeNull();
    expect(enter("<!--\n  theorem:|\n-->")).toBeNull();
  });
});
