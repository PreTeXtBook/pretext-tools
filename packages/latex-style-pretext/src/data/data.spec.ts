import { describe, it, expect } from "vitest";
import {
  ENVIRONMENTS,
  ENVIRONMENT_BY_NAME,
  isKnownEnvironment,
} from "./environments";
import { MACROS, isKnownMacro } from "./macros";
import { isKnownMathMacro, isKnownMathEnvironment } from "./math";

describe("environment table", () => {
  it("resolves canonical names and aliases to the same spec", () => {
    expect(isKnownEnvironment("theorem")).toBe(true);
    expect(ENVIRONMENT_BY_NAME.get("thm")).toBe(
      ENVIRONMENT_BY_NAME.get("theorem"),
    );
  });

  it("marks theorem-like environments as requiring a statement", () => {
    expect(ENVIRONMENT_BY_NAME.get("theorem")?.requiresStatement).toBe(true);
    expect(ENVIRONMENT_BY_NAME.get("remark")?.requiresStatement).toBe(false);
  });

  it("offers proof inside theorems and hint/answer/solution inside exercises", () => {
    expect(ENVIRONMENT_BY_NAME.get("theorem")?.childEnvironments).toContain(
      "proof",
    );
    expect(ENVIRONMENT_BY_NAME.get("exercise")?.childEnvironments).toEqual([
      "hint",
      "answer",
      "solution",
    ]);
  });

  it("classifies verbatim and list environments", () => {
    expect(ENVIRONMENT_BY_NAME.get("program")?.kind).toBe("verbatim");
    expect(ENVIRONMENT_BY_NAME.get("itemize")?.kind).toBe("list");
  });

  it("has no duplicate canonical/alias names", () => {
    const seen = new Set<string>();
    for (const spec of ENVIRONMENTS) {
      for (const name of [spec.name, ...spec.aliases]) {
        expect(seen.has(name), `duplicate environment name: ${name}`).toBe(
          false,
        );
        seen.add(name);
      }
    }
  });
});

describe("macro table", () => {
  it("knows text macros and their arities", () => {
    expect(isKnownMacro("term")).toBe(true);
    expect(MACROS.find((m) => m.name === "href")?.signature).toBe("m m");
    expect(MACROS.find((m) => m.name === "fillin")?.signature).toBe("");
  });

  it("does not treat unknown macros as supported", () => {
    expect(isKnownMacro("frac")).toBe(false); // math macro, not text
  });
});

describe("math support", () => {
  it("recognizes KaTeX macros and environments", () => {
    expect(isKnownMathMacro("frac")).toBe(true);
    expect(isKnownMathMacro("systeme")).toBe(true); // converter extra
    expect(isKnownMathEnvironment("align")).toBe(true);
    expect(isKnownMathEnvironment("pmatrix")).toBe(true);
  });
});
