import { describe, expect, it } from "vitest";
import {
  readMacroCall,
  removalsAreEquivalent,
  unwrapMacroText,
} from "./macro-call";

const call = (text: string, start = 0) => readMacroCall(text, start)!;

describe("readMacroCall", () => {
  it("spans the control word and its mandatory argument", () => {
    const text = "\\textbf{bold} rest";
    const c = call(text);
    expect(c.name).toBe("textbf");
    expect(text.slice(c.start, c.end)).toBe("\\textbf{bold}");
  });

  it("locates the argument content", () => {
    const text = "\\textbf{bold}";
    const [arg] = call(text).mandatoryArguments;
    expect(text.slice(arg.start, arg.end)).toBe("bold");
  });

  it("handles nested braces in the argument", () => {
    const text = "\\textbf{a {nested} b} tail";
    const c = call(text);
    expect(text.slice(c.start, c.end)).toBe("\\textbf{a {nested} b}");
    expect(unwrapMacroText(text, c)).toBe("a {nested} b");
  });

  it("is not fooled by an escaped brace", () => {
    const text = "\\textbf{a \\} b} tail";
    const c = call(text);
    expect(text.slice(c.start, c.end)).toBe("\\textbf{a \\} b}");
  });

  it("reads only as many arguments as the signature declares", () => {
    // `\textbf` takes one argument; the second group is ordinary text.
    const text = "\\textbf{a}{b}";
    const c = call(text);
    expect(text.slice(c.start, c.end)).toBe("\\textbf{a}");
    expect(c.mandatoryArguments).toHaveLength(1);
  });

  it("reads both arguments of a two-argument macro", () => {
    const text = "\\href{https://x}{link text}";
    const c = call(text);
    expect(text.slice(c.start, c.end)).toBe(text);
    expect(c.mandatoryArguments).toHaveLength(2);
    expect(unwrapMacroText(text, c)).toBe("https://xlink text");
  });

  it("steps over an optional argument", () => {
    const text = "\\includegraphics[width=2in]{fig.png}";
    const c = call(text);
    expect(text.slice(c.start, c.end)).toBe(text);
    expect(c.mandatoryArguments).toHaveLength(1);
    expect(unwrapMacroText(text, c)).toBe("fig.png");
  });

  it("steps over a starred form", () => {
    const text = "\\worksheet*{Title}";
    const c = call(text);
    expect(text.slice(c.start, c.end)).toBe(text);
    expect(unwrapMacroText(text, c)).toBe("Title");
  });

  it("tolerates whitespace before the argument", () => {
    const text = "\\textbf {bold}";
    expect(text.slice(0, call(text).end)).toBe("\\textbf {bold}");
  });

  it("treats a switch-style use as having no arguments", () => {
    const text = "{\\textbf bold words}";
    const c = call(text, 1);
    expect(c.end).toBe(c.nameEnd);
    expect(c.mandatoryArguments).toEqual([]);
    expect(removalsAreEquivalent(c)).toBe(true);
  });

  it("stops at an unbalanced argument rather than running to the end", () => {
    const text = "\\textbf{unclosed";
    const c = call(text);
    expect(c.end).toBe(c.nameEnd);
    expect(c.mandatoryArguments).toEqual([]);
  });

  it("returns null when there is no macro at the offset", () => {
    expect(readMacroCall("plain text", 0)).toBeNull();
    expect(readMacroCall("\\  spaces", 0)).toBeNull();
  });
});

describe("removal semantics", () => {
  it("unwrapping keeps the content, deleting does not", () => {
    const text = "before \\textbf{kept} after";
    const c = call(text, 7);
    expect(
      text.slice(0, c.start) + unwrapMacroText(text, c) + text.slice(c.end),
    ).toBe("before kept after");
    expect(text.slice(0, c.start) + "" + text.slice(c.end)).toBe(
      "before  after",
    );
  });

  it("reports the two as equivalent only when there is nothing to keep", () => {
    expect(removalsAreEquivalent(call("\\textbf{x}"))).toBe(false);
    expect(removalsAreEquivalent(call("{\\textbf x}", 1))).toBe(true);
  });
});
