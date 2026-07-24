import { describe, it, expect } from "vitest";
import { markdownToPretext } from "@pretextbook/remark-pretext";
import { CONTAINER_DIRECTIVES } from "./directives";

// Drift-guard: every curated container directive must still be recognized by
// the real converter. If someone renames or removes a directive in
// `@pretextbook/remark-pretext`, converting our curated name produces an
// `unknown directive` TODO placeholder, and this test fails — pointing at the
// exact entry to reconcile.

describe("curated directives match the converter", () => {
  it.each(CONTAINER_DIRECTIVES.map((d) => d.name))(
    "%s converts without an unsupported warning",
    (name) => {
      const xml = markdownToPretext(`:::${name}\nSome content.\n:::\n`);
      expect(xml).not.toContain(`unknown directive "${name}"`);
      expect(xml).not.toContain("unknown-directive");
    },
  );
});
