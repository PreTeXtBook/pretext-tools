import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * The shared ImportWizard (in @pretextbook/import) is styled with a fixed light
 * Tailwind palette; `importWizardPanel.ts` makes it dark-theme-aware by
 * redefining the `--color-*` variables those utilities compile to. Nothing in
 * the type system connects the two, so a color introduced in the component
 * keeps its light value in dark themes — which is how `text-blue-900` ended up
 * as navy text on a navy fill (1.3:1 contrast).
 *
 * This guard fails when the component reaches for a palette entry the panel has
 * not remapped.
 */

const wizardDir = path.resolve(__dirname, "../../import/src/react");
const panelFile = path.resolve(__dirname, "importWizardPanel.ts");

/** `--color-white` is handled separately: it stays light for button labels, and
 * the panel darkens only the `.bg-white` code surface. */
const EXEMPT_FAMILIES = new Set(["white", "black", "transparent", "current"]);

/** Tailwind's built-in color families, so `border-b-0` and friends don't read
 * as a color. */
const FAMILIES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|" +
  "teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

const COLOR_UTILITY = new RegExp(
  `\\b(?:bg|text|border|ring|fill|stroke|divide|outline|decoration|accent|caret|` +
    `placeholder|from|via|to)-(${FAMILIES})-(\\d{1,3})\\b`,
  "g",
);

function colorsUsedByWizard(): Set<string> {
  const used = new Set<string>();
  const files = fs
    .readdirSync(wizardDir)
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => path.join(wizardDir, file));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const [, family, shade] of source.matchAll(COLOR_UTILITY)) {
      if (!EXEMPT_FAMILIES.has(family)) {
        used.add(`${family}-${shade}`);
      }
    }
  }
  return used;
}

function colorsRemappedForDark(): Set<string> {
  const source = fs.readFileSync(panelFile, "utf8");
  return new Set(
    [...source.matchAll(/--color-([a-z]+-\d{1,3}):/g)].map(([, name]) => name),
  );
}

describe("import wizard dark theme", () => {
  it("remaps every palette color the wizard uses", () => {
    const missing = [...colorsUsedByWizard()]
      .filter((color) => !colorsRemappedForDark().has(color))
      .sort();
    expect(
      missing,
      `${missing.join(", ")} used by the ImportWizard but not remapped in ` +
        `importWizardPanel.ts — they will keep their light values in dark themes.`,
    ).toEqual([]);
  });

  it("gives native dropdowns an explicit surface", () => {
    // Tailwind's preflight resets <select> to a transparent background, and
    // Chromium paints the option popup from that background.
    const source = fs.readFileSync(panelFile, "utf8");
    expect(source).toMatch(/select option\s*\{[^}]*background-color:/);
  });
});
