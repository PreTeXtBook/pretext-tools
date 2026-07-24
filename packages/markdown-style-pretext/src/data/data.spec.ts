import { describe, it, expect } from "vitest";
import {
  CONTAINER_DIRECTIVES,
  CONTAINER_BY_NAME,
  LEAF_DIRECTIVES,
  isKnownContainerDirective,
} from "./directives";
import { isKnownMathMacro, isKnownMathEnvironment } from "./math";

describe("container directive table", () => {
  it("resolves canonical directive names", () => {
    expect(isKnownContainerDirective("theorem")).toBe(true);
    expect(isKnownContainerDirective("bogus")).toBe(false);
  });

  it("marks theorem/definition-like directives as requiring a statement", () => {
    expect(CONTAINER_BY_NAME.get("theorem")?.requiresStatement).toBe(true);
    expect(CONTAINER_BY_NAME.get("definition")?.requiresStatement).toBe(true);
    expect(CONTAINER_BY_NAME.get("remark")?.requiresStatement).toBe(false);
  });

  it("offers proof inside theorems and hint/answer/solution inside exercises", () => {
    expect(CONTAINER_BY_NAME.get("theorem")?.childDirectives).toContain(
      "proof",
    );
    expect(CONTAINER_BY_NAME.get("exercise")?.childDirectives).toEqual([
      "task",
      "hint",
      "answer",
      "solution",
    ]);
  });

  it("flags exercise/project/task as accepting nested tasks", () => {
    expect(CONTAINER_BY_NAME.get("exercise")?.hasNestedTasks).toBe(true);
    expect(CONTAINER_BY_NAME.get("project")?.hasNestedTasks).toBe(true);
    expect(CONTAINER_BY_NAME.get("theorem")?.hasNestedTasks).toBeUndefined();
  });

  it("has no duplicate directive names", () => {
    const seen = new Set<string>();
    for (const spec of CONTAINER_DIRECTIVES) {
      expect(seen.has(spec.name), `duplicate: ${spec.name}`).toBe(false);
      seen.add(spec.name);
    }
  });
});

describe("leaf (include) directives", () => {
  it("lists division and asset includes but never validates them", () => {
    const names = LEAF_DIRECTIVES.map((d) => d.name);
    expect(names).toContain("section");
    expect(names).toContain("image");
    // Leaf names are includes: they are not container directives.
    expect(isKnownContainerDirective("image")).toBe(false);
  });
});

describe("shared math support", () => {
  it("recognizes KaTeX macros and environments via the LaTeX package", () => {
    expect(isKnownMathMacro("frac")).toBe(true);
    expect(isKnownMathMacro("systeme")).toBe(true);
    expect(isKnownMathEnvironment("align")).toBe(true);
  });
});
