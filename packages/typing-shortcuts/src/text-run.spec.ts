import { describe, expect, it } from "vitest";
import { insideOpenSpan, MASK, textRun } from "./text-run";

const masked = (prefix: string) => {
  const { text, start } = textRun(prefix);
  return text.slice(start).replaceAll(MASK, "#");
};

const hashes = (element: string) => "#".repeat(element.length);

describe("textRun", () => {
  it("starts just past an opening tag", () => {
    expect(textRun("<p>abc")).toEqual({ text: "<p>abc", start: 3 });
  });

  it("masks complete elements and self-closing tags", () => {
    expect(masked("<p>a <m>x</m> b")).toBe(`a ${hashes("<m>x</m>")} b`);
    expect(masked('<p>a <xref ref="x"/> b')).toBe(
      `a ${hashes('<xref ref="x"/>')} b`,
    );
    expect(masked("<p>a <em>b <m>x</m></em> c")).toBe(
      `a ${hashes("<em>b <m>x</m></em>")} c`,
    );
  });

  it("matches nested elements of the same name", () => {
    expect(masked("<p>a <q>b <q>c</q></q> d")).toBe(
      `a ${hashes("<q>b <q>c</q></q>")} d`,
    );
  });

  it("stops at an end tag whose start isn't on the line", () => {
    expect(masked("text</em> more")).toBe(" more");
  });

  it("stops at a comment", () => {
    expect(masked("<!-- c --> after")).toBe(" after");
  });
});

describe("insideOpenSpan", () => {
  it("counts backticks and $ runs", () => {
    expect(insideOpenSpan("`a", 0, 2)).toBe(true);
    expect(insideOpenSpan("`a` b", 0, 5)).toBe(false);
    expect(insideOpenSpan("$a", 0, 2)).toBe(true);
    expect(insideOpenSpan("$$a", 0, 3)).toBe(true);
    expect(insideOpenSpan("$$a$$ b", 0, 7)).toBe(false);
    expect(insideOpenSpan("\\$a", 0, 3)).toBe(false);
  });
});
