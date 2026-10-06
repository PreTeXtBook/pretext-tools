import { describe, expect, it } from "vitest";
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
