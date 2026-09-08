import { describe, it, expect } from "vitest";
import { describeDetection } from "./paste-convert-core";

// Detection and placement are specified in @pretextbook/import
// (`detect-snippet-format`, `paste/place-markup`); what is left to check here
// is that the log line names both scores and the verdict.
describe("describeDetection", () => {
  it("reports both scores and the verdict, so a plain paste is explainable", () => {
    expect(describeDetection("Let $G$ be a \\emph{group}.")).toMatch(
      /latex=\d+ markdown=\d+ -> latex/,
    );
    expect(describeDetection("Just prose.")).toMatch(/-> none$/);
  });
});
