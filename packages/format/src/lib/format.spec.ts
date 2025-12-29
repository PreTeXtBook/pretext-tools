import { formatPretext } from "./format";

describe("format", () => {
  it("should format pretext content", () => {
    const input = "<pretext>sample content</pretext>";
    const result = formatPretext(input);
    expect(result).toBeDefined();
    // Add more specific assertions based on expected behavior
  });

  it("should handle empty input", () => {
    const result = formatPretext("");
    expect(result).toBe("");
  });
});
