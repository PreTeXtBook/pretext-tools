import { describe, it, expect } from "vitest";
import { getLatexCompletions } from "./get-completions";
import type { CompletionItem } from "vscode-languageserver-types";

/** Run completions at the "|" marker in a fixture. */
function complete(fixture: string): CompletionItem[] {
  const offset = fixture.indexOf("|");
  if (offset === -1) throw new Error("fixture needs a | cursor marker");
  return getLatexCompletions({ text: fixture.replace("|", ""), offset });
}

const labels = (items: CompletionItem[]) => items.map((i) => i.label);
const byLabel = (items: CompletionItem[], label: string) =>
  items.find((i) => i.label === label);

describe("environment completions", () => {
  it("offers environments after \\begin{", () => {
    const items = complete("\\begin{theo|");
    expect(labels(items)).toContain("theorem");
  });

  it("expands to a full begin/end skeleton", () => {
    const item = byLabel(complete("\\begin{theo|"), "theorem");
    expect(item?.textEdit?.newText).toBe("theorem}\n\t$0\n\\end{theorem}");
  });

  it("offers aliases, labelled as such", () => {
    const item = byLabel(complete("\\begin{thm|"), "thm");
    expect(item?.detail).toContain("alias of \\begin{theorem}");
    expect(item?.textEdit?.newText).toContain("\\end{thm}");
  });

  it("consumes an auto-closed brace so the skeleton is not doubled", () => {
    // Editor auto-closed the brace: `\begin{}` with the cursor inside.
    const item = byLabel(complete("\\begin{theo|}"), "theorem");
    // The edit range must cover the trailing `}` (end > start + prefix).
    const { start, end } = item!.textEdit!.range;
    expect(end.character).toBeGreaterThan(start.character + "theo".length);
  });

  it("seeds list environments with an \\item", () => {
    const item = byLabel(complete("\\begin{itemi|"), "itemize");
    expect(item?.textEdit?.newText).toContain("\\item");
  });

  it("boosts child environments of the enclosing environment", () => {
    const items = complete(
      "\\begin{theorem}\n text \n\\begin{pro|\n\\end{theorem}",
    );
    const proof = byLabel(items, "proof");
    // sortText prefix "0" marks a boosted child.
    expect(proof?.sortText?.startsWith("0")).toBe(true);
  });

  it("suggests closing the innermost open environment after \\end{", () => {
    const items = complete("\\begin{theorem}\n text \n\\end{|");
    expect(items[0].label).toBe("theorem");
    expect(items[0].textEdit?.newText).toBe("theorem}");
  });
});

describe("macro completions", () => {
  it("offers text macros after a backslash", () => {
    const items = complete("Some \\ter|");
    const term = byLabel(items, "term");
    expect(term?.textEdit?.newText).toBe("term{$1}");
  });

  it("offers \\begin as a synthetic keyword entry", () => {
    expect(labels(complete("\\beg|"))).toContain("begin");
  });

  it("switches to KaTeX macros inside math mode", () => {
    const items = complete("$ x = \\fra| $");
    expect(labels(items)).toContain("frac");
    // Text-only macros must not leak into math completions.
    expect(labels(items)).not.toContain("term");
  });

  it("suppresses completions inside comments", () => {
    expect(complete("text % a \\ter|")).toEqual([]);
  });

  it("suppresses completions inside verbatim environments", () => {
    expect(complete("\\begin{program}\n\\ter|\n\\end{program}")).toEqual([]);
  });
});

describe("reference completions", () => {
  it("completes \\ref against document labels", () => {
    const items = complete(
      "\\begin{theorem}\\label{thm:main}\\end{theorem}\nSee \\ref{|",
    );
    expect(labels(items)).toContain("thm:main");
  });

  it("completes \\hyperref[ ] labels too", () => {
    const items = complete("\\label{sec:one}\n\\hyperref[|");
    expect(labels(items)).toContain("sec:one");
  });
});
