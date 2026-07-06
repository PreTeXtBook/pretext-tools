import { describe, it, expect } from "vitest";
import {
  applyRules,
  defaultRuleset,
  relaxedRuleset,
  Severity,
} from "../rules";
import type { Ruleset, SchemaError } from "../types";

const baseRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

function err(partial: Partial<SchemaError>): SchemaError {
  return {
    kind: "element-not-allowed",
    message: "raw",
    uri: "untitled:doc",
    range: baseRange,
    ...partial,
  };
}

describe("applyRules", () => {
  it("tags diagnostics with a stable rule id and default severity", () => {
    const [diag] = applyRules([err({ name: "foo" })]);
    expect(diag.code).toBe("element-not-allowed");
    expect(diag.severity).toBe(Severity.Error);
    expect(diag.source).toBe("pretext");
    expect(diag.message).toMatch(/<foo> is not allowed/);
  });

  it("applies a custom severity override", () => {
    const ruleset: Ruleset = {
      rules: [
        {
          id: "element-not-allowed",
          match: (e) => e.kind === "element-not-allowed",
          severity: Severity.Warning,
        },
      ],
    };
    const [diag] = applyRules([err({ name: "foo" })], ruleset);
    expect(diag.severity).toBe(Severity.Warning);
  });

  it("suppresses filtered errors", () => {
    const ruleset: Ruleset = {
      rules: [
        {
          id: "ignore-text",
          match: (e) => e.kind === "text-not-allowed",
          suppress: true,
        },
      ],
    };
    const diags = applyRules(
      [err({ kind: "text-not-allowed", message: "text" })],
      ruleset,
    );
    expect(diags).toEqual([]);
  });

  it("rewrites the message via a template", () => {
    const ruleset: Ruleset = {
      rules: [
        {
          id: "x",
          match: () => true,
          message: (e) => `custom: ${e.name}`,
        },
      ],
    };
    const [diag] = applyRules([err({ name: "bar" })], ruleset);
    expect(diag.message).toBe("custom: bar");
  });

  it("suggests <md> for a removed <me> element", () => {
    const [diag] = applyRules(
      [err({ name: "me" })],
      defaultRuleset,
    );
    expect(diag.code).toBe("element-me-removed");
    expect(diag.message).toMatch(/<md>/);
  });

  it("suppresses <document-id>/<blurb> inside <docinfo> under the relaxed ruleset", () => {
    const diags = applyRules(
      [
        err({ kind: "element-not-allowed", name: "document-id", parent: "docinfo" }),
        err({ kind: "element-not-allowed", name: "blurb", parent: "docinfo" }),
      ],
      relaxedRuleset,
    );
    expect(diags).toEqual([]);
  });

  it("still reports <document-id> outside <docinfo> under the relaxed ruleset", () => {
    const [diag] = applyRules(
      [err({ kind: "element-not-allowed", name: "document-id", parent: "section" })],
      relaxedRuleset,
    );
    expect(diag.code).toBe("element-not-allowed");
  });

  it("still reports other violations under the relaxed ruleset", () => {
    const [diag] = applyRules(
      [err({ kind: "element-not-allowed", name: "bogus" })],
      relaxedRuleset,
    );
    expect(diag.code).toBe("element-not-allowed");
    expect(diag.message).toMatch(/<bogus> is not allowed/);
  });

  it("supports multiple rules firing on different errors", () => {
    const diags = applyRules(
      [
        err({ kind: "element-not-allowed", name: "a" }),
        err({ kind: "attribute-not-allowed", name: "b" }),
      ],
      defaultRuleset,
    );
    expect(diags.map((d) => d.code)).toEqual([
      "element-not-allowed",
      "attribute-not-allowed",
    ]);
  });
});
