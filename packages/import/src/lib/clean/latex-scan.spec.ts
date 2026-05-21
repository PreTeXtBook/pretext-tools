import { describe, expect, it } from "vitest";
import { scanForAnomalies, separatePieces } from "./latex-scan";

describe("separatePieces", () => {
  it("splits preamble/body at \\begin{document}", () => {
    const { preamble, body } = separatePieces(
      "\\documentclass{article}\n\\begin{document}\nhi",
    );
    expect(preamble).toBe("\\documentclass{article}\n");
    expect(body).toBe("\nhi");
  });

  it("splits off the bibliography", () => {
    const { body, bibliography } = separatePieces(
      "\\begin{document}\nhi\n\\begin{thebibliography}\n[1] foo",
    );
    expect(body).toBe("\nhi\n");
    expect(bibliography).toContain("[1] foo");
  });

  it("returns the whole input as body when no \\begin{document} present", () => {
    const { preamble, body } = separatePieces("just text");
    expect(preamble).toBe("");
    expect(body).toBe("just text");
  });
});

describe("scanForAnomalies", () => {
  it("deletes \\smallskip, \\bigskip, etc. and records warnings", () => {
    const { output, warnings } = scanForAnomalies(
      "\\begin{document}\nA\\smallskip B\\bigskip\n",
    );
    expect(output).not.toMatch(/\\smallskip|\\bigskip/);
    const deleted = warnings.filter((w) => w.action === "delete");
    expect(deleted.map((w) => w.macro)).toEqual(
      expect.arrayContaining(["smallskip", "bigskip"]),
    );
  });

  it("deletes \\hspace{...} (hasarg) along with its braced argument", () => {
    const { output } = scanForAnomalies(
      "\\begin{document}\nbefore\\hspace{1cm}after",
    );
    expect(output).not.toMatch(/\\hspace/);
    expect(output).toMatch(/beforeafter/);
  });

  it("removes \\begin{center}/\\end{center} from the body", () => {
    const { output } = scanForAnomalies(
      "\\begin{document}\n\\begin{center}hi\\end{center}",
    );
    expect(output).not.toMatch(/center/);
  });

  it("marks but does not delete badPlainTeX font macros in the body", () => {
    const { output, warnings } = scanForAnomalies(
      "\\begin{document}\nhello \\textit{world}",
    );
    expect(output).toMatch(/\\textit/);
    const marked = warnings.filter((w) => w.action === "anomaly");
    expect(marked.find((w) => w.macro === "textit")).toBeTruthy();
  });

  it("saves \\renewcommand lines as warnings before deleting", () => {
    const { output, warnings } = scanForAnomalies(
      "\\renewcommand{\\thefoo}{1}\n\\begin{document}\nhi",
    );
    expect(output).not.toMatch(/renewcommand/);
    const saved = warnings.find(
      (w) => w.action === "save" && w.macro === "renewcommand",
    );
    expect(saved).toBeTruthy();
    expect(saved?.examples?.[0]).toContain("renewcommand");
  });
});
