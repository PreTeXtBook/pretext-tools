import { describe, expect, it } from "vitest";
import { CompletionItemKind } from "vscode-languageserver-types";
import { getPretextCompletions } from "./get-completions";
import type { CompletionSchema } from "./types";

const text = "<book>\n <";
const position = { line: 1, character: 2 };

describe("getPretextCompletions schema fallback", () => {
  it("uses bundled default dev schema when schema is omitted", async () => {
    const items = await getPretextCompletions({
      text,
      position,
    });

    expect(items).not.toBeNull();
    expect(items?.some((item) => item.label === "<chapter>")).toBe(true);
  });

  it("uses provided schema when explicitly supplied", async () => {
    const customSchema: CompletionSchema = {
      elementChildren: {
        book: {
          elements: ["custom-element"],
          attributes: [],
        },
        "custom-element": {
          elements: [],
          attributes: [],
        },
      },
    };

    const items = await getPretextCompletions({
      text,
      position,
      schema: customSchema,
    });

    expect(items).not.toBeNull();
    expect(items?.some((item) => item.label === "<custom-element")).toBe(true);
    expect(items?.some((item) => item.label === "<chapter>")).toBe(false);
  });
});

describe("getPretextCompletions sort order", () => {
  // Editors rank equally good matches by sortText, filling in the label when
  // an item has none, so that is the key a curated element has to win on.
  const sortKey = (item: { label: string; sortText?: string }) =>
    item.sortText ?? item.label;

  it.each([
    ["<q>", "<quantity"],
    ["<md>", "<mdash"],
  ])("ranks %s ahead of %s", async (curated, generic) => {
    const items = await getPretextCompletions({
      text: "<p>Some text <",
      position: { line: 0, character: 14 },
    });

    const find = (label: string) => items?.find((item) => item.label === label);
    expect(find(curated)).toBeDefined();
    expect(find(generic)).toBeDefined();
    expect(sortKey(find(curated)!) < sortKey(find(generic)!)).toBe(true);
  });

  it("gives every element completion a sortText", async () => {
    const items = await getPretextCompletions({
      text: "<p>Some text <",
      position: { line: 0, character: 14 },
    });

    const elements = items?.filter((item) => !item.label.startsWith("</"));
    expect(elements?.length).toBeGreaterThan(0);
    expect(elements?.every((item) => item.sortText)).toBe(true);
  });
});

describe("getPretextCompletions at the start of a line", () => {
  it("offers element snippets for a `<` typed in column 0", async () => {
    const items = await getPretextCompletions({
      text: '<article xml:id="a">\n<title>T</title>\n<',
      position: { line: 2, character: 1 },
    });
    expect(items?.some((item) => item.label === "<section>")).toBe(true);
  });

  it("offers none in the middle of a word in column 0", async () => {
    const items = await getPretextCompletions({
      text: "<article>\nab",
      position: { line: 1, character: 2 },
    });
    expect(items).toBeNull();
  });
});

describe("getPretextCompletions in a start tag's name", () => {
  // A selection wrapped by typing `<`: carets in `<|>` and the mirroring `</|>`.
  const wrapped = (line: string) => {
    const character = line.indexOf("|");
    return getPretextCompletions({
      text: line.replace("|", ""),
      position: { line: 0, character },
    });
  };

  it("offers bare names of the elements allowed there", async () => {
    const items = await wrapped("<p>Let <|>x</> be.</p>");
    const labels = items?.map((item) => item.label);
    expect(labels).toContain("em");
    expect(labels).toContain("m");
    expect(labels).not.toContain("section");
    expect(labels?.some((label) => label.startsWith("<"))).toBe(false);
    expect(items?.find((item) => item.label === "em")?.textEdit).toEqual({
      newText: "em",
      range: {
        start: { line: 0, character: 8 },
        end: { line: 0, character: 8 },
      },
    });
  });

  it("replaces just the name, wherever the caret is in it", async () => {
    const items = await wrapped("<p>Let <e|m>x</em> be.</p>");
    expect(items?.find((item) => item.label === "em")?.textEdit).toEqual({
      newText: "em",
      range: {
        start: { line: 0, character: 8 },
        end: { line: 0, character: 10 },
      },
    });
  });

  it("ranks curated elements first", async () => {
    const items = await wrapped("<p>Let <|>x</> be.</p>");
    const sortKey = (label: string) =>
      items?.find((item) => item.label === label)?.sortText ?? label;
    expect(sortKey("em") < sortKey("abbr")).toBe(true);
  });

  it("still offers element snippets for a `<` just typed", async () => {
    const items = await wrapped("<p>Let <| be.</p>");
    expect(items?.some((item) => item.label === "<em>")).toBe(true);
  });
});

describe("getPretextCompletions at the document root", () => {
  const at = (text: string) => {
    const lines = text.split("\n");
    return getPretextCompletions({
      text,
      position: {
        line: lines.length - 1,
        character: lines[lines.length - 1].length,
      },
    });
  };
  const labels = async (text: string) =>
    (await at(text))?.map((item) => item.label) ?? [];
  const templates = async (text: string) =>
    (await labels(text)).filter((label) => label.startsWith("<!ptx-"));

  it("offers the whole-file templates in an empty document", async () => {
    const found = await templates("");
    expect(found).toContain("<!ptx-article");
    expect(found).toContain("<!ptx-book");
    expect(found).toContain("<!ptx-slideshow");
    expect(found).toContain("<!ptx-chapter");
    expect(found).toContain("<!ptx-section");
    expect(found).toContain("<!ptx-worksheet");
    expect(found).toContain("<!ptx-handout");
  });

  it("offers them after the XML declaration, for a `<` just typed", async () => {
    const text = '<?xml version="1.0" encoding="UTF-8"?>\n\n<';
    expect(await templates(text)).toContain("<!ptx-article");
    const article = (await at(text))?.find(
      (item) => item.label === "<!ptx-article",
    );
    // The edit replaces the `<` so the template is not left with two.
    expect(article?.textEdit?.range).toEqual({
      start: { line: 2, character: 0 },
      end: { line: 2, character: 1 },
    });
    expect(article?.textEdit?.newText).toMatch(/^<\?xml .*\n\n<pretext>/);
  });

  it("offers the elements a file may start with, alongside", async () => {
    const found = await labels("<");
    expect(found).toContain("<chapter>");
    expect(found).toContain("<section>");
    expect(found).toContain("<pretext");
    // Only roots: `<p>` belongs inside a division.
    expect(found).not.toContain("<p>");
    expect(found.some((label) => label.startsWith("</"))).toBe(false);
  });

  it("ranks the templates ahead of the root elements", async () => {
    const items = await at("<");
    const sortKey = (label: string) =>
      items?.find((item) => item.label === label)?.sortText ?? label;
    expect(sortKey("<!ptx-chapter") < sortKey("<chapter>")).toBe(true);
  });

  it("keeps matching while `<!ptx-` is being typed, replacing it all", async () => {
    const items = await at("<!ptx-art");
    const found = items?.map((item) => item.label);
    expect(found).toContain("<!ptx-article");
    expect(found?.every((label) => label.startsWith("<!ptx-"))).toBe(true);
    expect(
      items?.find((item) => item.label === "<!ptx-article")?.textEdit?.range,
    ).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 9 },
    });
  });

  it("does not give the templates the Snippet kind", async () => {
    // VS Code hides that kind under `editor.snippetSuggestions: "none"`.
    const items = await at("");
    const found = items?.filter((item) => item.label.startsWith("<!ptx-"));
    expect(found?.length).toBeGreaterThan(0);
    expect(
      found?.some((item) => item.kind === CompletionItemKind.Snippet),
    ).toBe(false);
  });

  it("does not take a comment's `<!-` for a template", async () => {
    expect(await templates("<!-")).toEqual([]);
  });

  it("offers no templates inside an element", async () => {
    expect(await templates("<book>\n <")).toEqual([]);
    expect(await templates("<book>\n <!ptx")).toEqual([]);
    expect(await at("<book>\n <!ptx")).toEqual([]);
  });

  it("offers a template only where the schema has its root element", async () => {
    const schema: CompletionSchema = {
      elementChildren: {
        project: { elements: ["targets"], attributes: [] },
        targets: { elements: [], attributes: [] },
      },
      rootElements: ["project"],
    };
    const items = await getPretextCompletions({
      text: "",
      position: { line: 0, character: 0 },
      schema,
    });
    const found = items?.map((item) => item.label);
    // The curated `<project>` (a project-like block) is the one root; no
    // template has `project` as its root.
    expect(found).toEqual(["<project>"]);
  });

  it("takes every element for a root when the schema names none", async () => {
    const schema: CompletionSchema = {
      elementChildren: {
        chapter: { elements: ["p"], attributes: [] },
        p: { elements: [], attributes: [] },
      },
    };
    const items = await getPretextCompletions({
      text: "",
      position: { line: 0, character: 0 },
      schema,
    });
    const found = items?.map((item) => item.label);
    expect(found).toContain("<!ptx-chapter");
    expect(found).not.toContain("<!ptx-article");
    expect(found).toContain("<chapter>");
    expect(found).toContain("<p>");
  });
});
