import { describe, expect, it } from "vitest";
import { findLatexFixes, findDocumentRegions } from "./find-fixes";
import {
  applyLatexFixes,
  cleanLatexText,
  latexFixesToTextEdits,
} from "./apply-fixes";
import { CLEAN_RULES, FONT_DIRECTIVE_PAIRS } from "./rules";

/** Convenience: clean a body fragment and return the text. */
const clean = (text: string, scope: "auto" | "body" | "document" = "auto") =>
  cleanLatexText(text, { scope }).output;

describe("findDocumentRegions", () => {
  it("splits preamble from body at \\begin{document}", () => {
    const text = "\\documentclass{article}\n\\begin{document}\nhi";
    const { preamble, body } = findDocumentRegions(text);
    expect(text.slice(preamble.start, preamble.end)).toBe(
      "\\documentclass{article}\n",
    );
    expect(text.slice(body.start, body.end)).toBe("\nhi");
  });

  it("splits off the bibliography", () => {
    const text = "\\begin{document}\nhi\n\\begin{thebibliography}\n[1] foo";
    const { body, bibliography } = findDocumentRegions(text);
    expect(text.slice(body.start, body.end)).toBe("\nhi\n");
    expect(bibliography).not.toBeNull();
    expect(text.slice(bibliography!.start)).toContain("[1] foo");
  });

  it("treats a fragment with no \\begin{document} as all body", () => {
    const { preamble, body } = findDocumentRegions("just text");
    expect(preamble.end - preamble.start).toBe(0);
    expect(body).toEqual({ start: 0, end: "just text".length });
  });
});

describe("plain-TeX font directives", () => {
  it("rewrites {\\bf foo} to \\textbf{foo}", () => {
    expect(clean("{\\bf hello}")).toBe("\\textbf{hello}");
  });

  it("reports each directive it replaced, with positions", () => {
    const fixes = findLatexFixes("{\\bf x} and {\\it y} and {\\bf z}");
    const bf = fixes.filter((f) => f.ruleId === "tex-font-bf");
    const it = fixes.filter((f) => f.ruleId === "tex-font-it");
    expect(bf).toHaveLength(2);
    expect(it).toHaveLength(1);
    expect(bf[0].start).toBe(0);
    expect(bf[1].start).toBe(24);
  });

  it("leaves unrelated text alone", () => {
    const fixes = findLatexFixes("no plain tex here");
    expect(fixes).toEqual([]);
  });

  it("preserves the upstream typos so behavior matches PreprocessLaTeX", () => {
    const pairs = Object.fromEntries(
      FONT_DIRECTIVE_PAIRS.map((p) => [p.from, p.to]),
    );
    expect(pairs.sffamily).toBe("textss");
    expect(pairs.textsl).toBe("testsl");
  });
});

describe("special rewrites", () => {
  it("rewrites (\\ref{x}) to \\eqref{x}", () => {
    expect(clean("see (\\ref{eq:foo})")).toBe("see \\eqref{eq:foo}");
  });

  it("rewrites an empty \\underline{} to \\fillin", () => {
    expect(clean("Name: \\underline{}")).toBe("Name: \\fillin");
  });

  it("rewrites \\underline{} with whitespace inside to \\fillin", () => {
    expect(clean("\\underline{   }")).toBe("\\fillin");
  });

  it("leaves a non-empty \\underline{...} alone", () => {
    expect(clean("\\underline{keep me}")).toBe("\\underline{keep me}");
  });

  it("collapses \\vfill / \\vfil chains into one \\vspace{1in}", () => {
    expect(clean("\\vfill\n\\vfil\\vfil")).toBe("\\vspace{1in}");
  });

  it("rewrites \\vskip 2cm to \\vspace{2cm}", () => {
    expect(clean("\\vskip 2cm")).toBe("\\vspace{2cm}");
  });

  it("normalizes \\vspace*{ 2 cm } to \\vspace{2cm}", () => {
    expect(clean("\\vspace*{ 2 cm }")).toBe("\\vspace{2cm}");
  });

  it("settles: a rewritten \\vspace does not keep re-matching", () => {
    const { passes, truncated } = cleanLatexText("\\vfill");
    expect(truncated).toBe(false);
    expect(passes).toBeLessThanOrEqual(2);
  });
});

describe("anomaly deletions", () => {
  it("deletes bare spacing macros and records them", () => {
    const { output, fixes } = cleanLatexText(
      "\\begin{document}\nA\\smallskip B\\bigskip\n",
    );
    expect(output).not.toMatch(/\\smallskip|\\bigskip/);
    expect(fixes.map((f) => f.macro)).toEqual(
      expect.arrayContaining(["smallskip", "bigskip"]),
    );
  });

  it("deletes \\hspace{...} along with its braced argument", () => {
    expect(clean("\\begin{document}\nbefore\\hspace{1cm}after")).toContain(
      "beforeafter",
    );
  });

  it("deletes \\definecolor with all three arguments", () => {
    expect(clean("\\begin{document}\n\\definecolor{a}{rgb}{1,0,0}x")).toContain(
      "\nx",
    );
  });

  it("removes \\begin{center}/\\end{center} but keeps the content", () => {
    const output = clean("\\begin{document}\n\\begin{center}hi\\end{center}");
    expect(output).not.toMatch(/center/);
    expect(output).toContain("hi");
  });

  it("flags but does not delete presentational font macros in the body", () => {
    const { output, fixes } = cleanLatexText(
      "\\begin{document}\nhello \\textit{world}",
    );
    expect(output).toMatch(/\\textit/);
    const flagged = fixes.find((f) => f.macro === "textit");
    expect(flagged?.action).toBe("flag");
    expect(flagged?.replacement).toBeUndefined();
  });

  it("keeps the matched text for rules the author needs to see", () => {
    const { output, fixes } = cleanLatexText(
      "\\renewcommand{\\thefoo}{1}\n\\begin{document}\nhi",
    );
    expect(output).not.toMatch(/renewcommand/);
    const saved = fixes.find((f) => f.macro === "renewcommand");
    expect(saved?.reportMatch).toBe(true);
    expect(saved?.matched).toContain("renewcommand");
  });

  it("does not flag font macros in the preamble (body-scoped rule)", () => {
    const fixes = findLatexFixes(
      "\\newcommand{\\x}{\\textbf{y}}\n\\begin{document}\nz",
    );
    expect(fixes.some((f) => f.macro === "textbf")).toBe(false);
  });

  it("never touches the bibliography", () => {
    const text =
      "\\begin{document}\nhi\n\\begin{thebibliography}\n\\bigskip \\textit{x}";
    const { output } = cleanLatexText(text);
    expect(output).toContain("\\bigskip \\textit{x}");
  });
});

describe("protected regions", () => {
  it("leaves plain-TeX directives inside verbatim alone", () => {
    const text =
      "\\begin{verbatim}\n{\\bf literal}\n\\end{verbatim}\n{\\bf real}";
    const output = clean(text, "body");
    expect(output).toContain("{\\bf literal}");
    expect(output).toContain("\\textbf{real}");
  });

  it("leaves deletable macros inside a code listing alone", () => {
    const output = clean(
      "\\begin{lstlisting}\n\\bigskip\n\\end{lstlisting}",
      "body",
    );
    expect(output).toContain("\\bigskip");
  });

  it("ignores macros inside comments", () => {
    const fixes = findLatexFixes("% \\bigskip is commented out\nreal text", {
      scope: "body",
    });
    expect(fixes).toEqual([]);
  });
});

describe("overlap resolution", () => {
  it("prefers a whole-line deletion over a bare macro inside that line", () => {
    const output = clean(
      "\\begin{document}\n\\setlength\\parindent{0pt}\nkeep",
      "document",
    );
    expect(output).not.toContain("setlength");
    expect(output).not.toContain("parindent");
    expect(output).toContain("keep");
  });

  it("returns fixes in source order with no overlapping edits", () => {
    const fixes = findLatexFixes(
      "\\begin{document}\n{\\bf a} \\bigskip {\\it b}",
    );
    const edits = fixes.filter((f) => f.replacement !== undefined);
    for (let i = 1; i < edits.length; i += 1) {
      expect(edits[i].start).toBeGreaterThanOrEqual(edits[i - 1].end);
    }
  });
});

describe("applyLatexFixes", () => {
  it("applies a single fix without disturbing other offsets", () => {
    const text = "{\\bf a} and {\\it b}";
    const fixes = findLatexFixes(text);
    const one = fixes.find((f) => f.ruleId === "tex-font-it")!;
    const { output } = applyLatexFixes(text, [one]);
    expect(output).toBe("{\\bf a} and \\textit{b}");
  });

  it("skips a fix that overlaps one already applied", () => {
    const fix = { start: 0, end: 5, replacement: "X" } as never;
    const { applied } = applyLatexFixes("abcdefg", [
      fix,
      { start: 2, end: 7, replacement: "Y" } as never,
    ]);
    expect(applied).toHaveLength(1);
  });

  it("builds LSP text edits with line/character ranges", () => {
    const text = "line one\n{\\bf b}";
    const edits = latexFixesToTextEdits(text, findLatexFixes(text));
    expect(edits[0].range.start).toEqual({ line: 1, character: 0 });
    expect(edits[0].newText).toBe("\\textbf{");
  });
});

describe("rule table", () => {
  it("has unique rule ids", () => {
    const ids = CLEAN_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every non-flag rule something to apply", () => {
    for (const rule of CLEAN_RULES) {
      if (rule.action === "replace") expect(rule.replacement).toBeTruthy();
    }
  });
});
