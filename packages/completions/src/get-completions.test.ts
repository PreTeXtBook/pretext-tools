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
