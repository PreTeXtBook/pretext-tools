import { describe, expect, it } from "vitest";
import { openBornHiddenKnowls } from "./knowls.js";

describe("openBornHiddenKnowls", () => {
  it("opens a born-hidden knowl and its summary", () => {
    const html = openBornHiddenKnowls(
      `<details id="ex1-3" class="solution solution-like born-hidden-knowl">` +
        `<summary class="knowl__link"><h3>Solution</h3></summary>` +
        `<article class="knowl__content"><p>42</p></article></details>`,
    );
    expect(html).toContain(
      `<details open id="ex1-3" class="solution solution-like born-hidden-knowl">`,
    );
    // The summary is marked too, which is what the theme's tinted-heading
    // rule keys on; see openBornHiddenKnowls.
    expect(html).toContain(`<summary open class="knowl__link">`);
    // Content is untouched.
    expect(html).toContain(
      `<article class="knowl__content"><p>42</p></article>`,
    );
  });

  it("leaves other details elements collapsed", () => {
    const html =
      `<details class="ptx-footnote" aria-live="polite" id="s1-2-1">` +
      `<summary class="ptx-footnote__number">1</summary>x</details>` +
      `<details class="image-description"><summary>Description</summary>y</details>` +
      `<details class="print-options"><summary>Options</summary>z</details>`;
    expect(openBornHiddenKnowls(html)).toBe(html);
  });

  it("matches the class as a whole word, not a substring", () => {
    const html = `<details class="not-born-hidden-knowlish"><summary>s</summary></details>`;
    expect(openBornHiddenKnowls(html)).toBe(html);
  });

  it("is idempotent, so a re-processed page gains no duplicate attribute", () => {
    const once = openBornHiddenKnowls(
      `<details class="born-hidden-knowl"><summary class="knowl__link">s</summary></details>`,
    );
    expect(openBornHiddenKnowls(once)).toBe(once);
    expect(once.match(/\bopen\b/g)).toHaveLength(2);
  });

  it("opens a knowl whose details has no summary", () => {
    expect(
      openBornHiddenKnowls(
        `<details class="born-hidden-knowl"><p>x</p></details>`,
      ),
    ).toBe(`<details open class="born-hidden-knowl"><p>x</p></details>`);
  });

  it("preserves the whitespace between details and summary", () => {
    expect(
      openBornHiddenKnowls(
        `<details class="born-hidden-knowl">\n<summary>s</summary></details>`,
      ),
    ).toBe(
      `<details open class="born-hidden-knowl">\n<summary open>s</summary></details>`,
    );
  });

  it("does not touch escaped markup in a code sample", () => {
    const html = `<pre>&lt;details class="born-hidden-knowl"&gt;</pre>`;
    expect(openBornHiddenKnowls(html)).toBe(html);
  });
});
