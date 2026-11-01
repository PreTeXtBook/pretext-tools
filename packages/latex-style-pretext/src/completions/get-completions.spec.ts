import { describe, it, expect } from "vitest";
import { getLatexCompletions } from "./get-completions";
import {
  InsertTextFormat,
  type CompletionItem,
} from "vscode-languageserver-types";

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

  it("does not suggest aliases, preferring the canonical name", () => {
    // `thm` is a valid alias of `theorem`, but it should not appear as its own
    // suggestion — only canonical names are offered.
    expect(labels(complete("\\begin{thm|"))).not.toContain("thm");
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

  it("offers only math environments inside math", () => {
    const items = complete("\\[\n\\begin{|\n\\]");
    expect(labels(items)).toContain("pmatrix");
    expect(labels(items)).not.toContain("theorem");
  });

  it("writes the whole environment for a math environment", () => {
    const item = byLabel(complete("\\[\\begin{pm|\\]"), "pmatrix");
    expect(item?.textEdit?.newText).toBe("pmatrix}\n\t$0\n\\end{pmatrix}");
  });

  it("offers display math, but not inner math, in text mode", () => {
    const items = labels(complete("\\begin{|"));
    expect(items).toContain("align");
    expect(items).not.toContain("pmatrix");
  });
});

describe("\\begin{...} snippet", () => {
  const skeleton = (name: string) => `\\begin{${name}|}\n\t\n\\end{${name}}\n`;

  it("offers the whole environment after a backslash", () => {
    const item = byLabel(complete("\\|"), "\\begin{...}");
    expect(item?.textEdit?.newText).toBe("begin{$1}\n\t$0\n\\end{$1}");
    expect(item?.insertTextFormat).toBe(InsertTextFormat.Snippet);
  });

  it("is first, and matches on the macro name", () => {
    const items = complete("\\beg|");
    const sorted = [...items].sort((a, b) =>
      a.sortText!.localeCompare(b.sortText!),
    );
    expect(sorted[0].label).toBe("\\begin{...}");
    expect(sorted[0].filterText).toBe("begin");
  });

  it("opens the list of names straight away", () => {
    expect(byLabel(complete("\\|"), "\\begin{...}")?.command?.command).toBe(
      "editor.action.triggerSuggest",
    );
  });

  it("is offered in math too, in place of the plain macro", () => {
    const items = labels(complete("$\\beg|$"));
    expect(items).toContain("\\begin{...}");
    expect(items).not.toContain("begin");
  });

  it("completes only the name, since the rest is already written", () => {
    const item = byLabel(complete(skeleton("")), "theorem");
    expect(item?.textEdit?.newText).toBe("theorem");
    expect(item?.insertTextFormat).toBe(InsertTextFormat.PlainText);
  });

  it("leaves the closing brace alone, which a full skeleton would consume", () => {
    const item = byLabel(complete(skeleton("theo")), "theorem");
    const { start, end } = item!.textEdit!.range;
    expect(end.character - start.character).toBe("theo".length);
  });

  it("moves into the body once a name is chosen", () => {
    expect(
      byLabel(complete(skeleton("theo")), "theorem")?.command?.command,
    ).toBe("jumpToNextSnippetPlaceholder");
  });

  it("offers names for the place it was inserted", () => {
    const items = complete(
      `\\begin{theorem}\n${skeleton("pro")}\\end{theorem}\n`,
    );
    expect(byLabel(items, "proof")?.sortText?.startsWith("0")).toBe(true);
  });

  it("does not mistake an enclosing \\end for its own", () => {
    // `\begin{}` typed by hand as the last line of a theorem: the `\end{theorem}`
    // that follows closes the theorem, so a chosen name needs its own `\end`.
    const item = byLabel(
      complete("\\begin{theorem}\n\\begin{pro|}\n\\end{theorem}"),
      "proof",
    );
    expect(item?.textEdit?.newText).toBe("proof}\n\t$0\n\\end{proof}");
    expect(item?.command).toBeUndefined();
  });

  it("completes only the name when a filled-in pair already exists", () => {
    const item = byLabel(
      complete("\\begin{theorem|}\n\\end{theorem}"),
      "theorem",
    );
    expect(item?.textEdit?.newText).toBe("theorem");
  });
});

describe("macro completions", () => {
  it("offers text macros after a backslash", () => {
    const items = complete("Some \\ter|");
    const term = byLabel(items, "term");
    expect(term?.textEdit?.newText).toBe("term{$1}");
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

describe("plus include completions", () => {
  it("offers \\plus among the text macros", () => {
    const item = byLabel(complete("\\plu|"), "plus");
    expect(item?.textEdit?.newText).toBe("plus{${1:chapter}}{${2:ref}}");
  });

  it("offers include types inside \\plus{", () => {
    const items = complete("\\plus{|");
    expect(labels(items)).toContain("chapter");
    expect(labels(items)).toContain("image");
    // Divisions sort ahead of assets.
    expect(byLabel(items, "chapter")?.sortText?.startsWith("0")).toBe(true);
    expect(byLabel(items, "image")?.sortText?.startsWith("1")).toBe(true);
  });

  it("opens the ref argument when completing the type", () => {
    expect(
      byLabel(complete("\\plus{chap|"), "chapter")?.textEdit?.newText,
    ).toBe("chapter}{$1}");
  });

  it("does not duplicate a ref argument that is already written", () => {
    expect(
      byLabel(complete("\\plus{chap|}{ch-intro}"), "chapter")?.textEdit
        ?.newText,
    ).toBe("chapter}");
  });

  it("still offers types after the optional attribute argument", () => {
    expect(labels(complete("\\plus[width=50]{ima|"))).toContain("image");
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
