import { describe, expect, it } from "vitest";
import { badPlainTeXdirectives } from "./latex-data";
import { fixPlainTeX, specialPreprocess } from "./latex-clean";

describe("fixPlainTeX (tex_fonts)", () => {
  it("rewrites {\\bf foo} to \\textbf{foo", () => {
    const { output } = fixPlainTeX("{\\bf hello}", badPlainTeXdirectives);
    expect(output).toBe("\\textbf{hello}");
  });

  it("reports which macros it replaced and how many", () => {
    const { warnings } = fixPlainTeX(
      "{\\bf x} and {\\it y} and {\\bf z}",
      badPlainTeXdirectives,
    );
    const bf = warnings.find((w) => w.macro === "bf");
    const it = warnings.find((w) => w.macro === "it");
    expect(bf?.occurrences).toBe(2);
    expect(it?.occurrences).toBe(1);
  });

  it("does not change unrelated text", () => {
    const { output, warnings } = fixPlainTeX(
      "no plain tex here",
      badPlainTeXdirectives,
    );
    expect(output).toBe("no plain tex here");
    expect(warnings).toEqual([]);
  });
});

describe("specialPreprocess", () => {
  it("rewrites (\\ref{x}) to \\eqref{x}", () => {
    const { output, warnings } = specialPreprocess("see (\\ref{eq:foo})");
    expect(output).toBe("see \\eqref{eq:foo}");
    expect(warnings[0]?.action).toBe("rewrite");
  });

  it("collapses \\vfill / \\vfil chains and rewrites as \\vspace{1in}", () => {
    const { output } = specialPreprocess("\\vfill\n\\vfil\\vfil");
    expect(output).toBe("\\vspace{1in}");
  });

  it("rewrites \\vskip 2cm to \\vspace{2cm}", () => {
    const { output } = specialPreprocess("\\vskip 2cm");
    expect(output).toBe("\\vspace{2cm}");
  });
});
