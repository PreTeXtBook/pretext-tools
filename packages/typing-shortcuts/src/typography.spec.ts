import { describe, expect, it } from "vitest";
import { editor } from "./spec-utils";

const typed = (marked: string, text: string, options = {}) =>
  editor(marked, options).typeText(text).text;

describe("typography", () => {
  it("converts -- and --- on the space after them", () => {
    expect(typed("<p>|</p>", "pages 1 -- 3")).toBe(
      "<p>pages 1 <ndash/> 3|</p>",
    );
    expect(typed("<p>|</p>", "wait--- what")).toBe("<p>wait<mdash/> what|</p>");
  });

  it("converts ... on the space after it", () => {
    expect(typed("<p>|</p>", "and so on... ")).toBe(
      "<p>and so on<ellipsis/> |</p>",
    );
  });

  it("waits for the space", () => {
    expect(typed("<p>|</p>", "1--3")).toBe("<p>1--3|</p>");
    expect(typed("<p>|</p>", "use --verbose")).toBe("<p>use --verbose|</p>");
  });

  it("leaves other run lengths alone", () => {
    expect(typed("<p>|</p>", "a ---- b")).toBe("<p>a ---- b|</p>");
    expect(typed("<p>|</p>", "a .... b")).toBe("<p>a .... b|</p>");
    expect(typed("<p>|</p>", "a - b. ")).toBe("<p>a - b. |</p>");
  });

  it("does nothing in math, code, comments or an open code span", () => {
    expect(typed("<p><m>|</m></p>", "1,2,... ")).toBe(
      "<p><m>1,2,... |</m></p>",
    );
    expect(typed("<pre>|</pre>", "-- ")).toBe("<pre>-- |</pre>");
    expect(typed("<p>|</p>", "`npm -- ")).toBe("<p>`npm -- |</p>");
    expect(typed("<!-- |", "-- ")).toBe("<!-- -- |");
  });

  it("can be turned off", () => {
    expect(typed("<p>|</p>", "a -- ", { typography: false })).toBe(
      "<p>a -- |</p>",
    );
  });
});
