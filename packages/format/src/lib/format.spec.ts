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

  it("should not introduce a linebreak when xi:include is inline inside another tag", () => {
    const input = `    <webwork><xi:include href="test.pg" parse="text"/></webwork>`;
    const result = formatPretext(input);
    // The xi:include should remain on the same line as <webwork> and </webwork>
    expect(result).toContain(
      `<webwork><xi:include href="test.pg" parse="text"/></webwork>`,
    );
    expect(result).not.toMatch(/<webwork>\s*\n\s*<xi:include/);
    expect(result).not.toMatch(/<xi:include[^>]*\/>\s*\n\s*<\/webwork>/);
  });
});
