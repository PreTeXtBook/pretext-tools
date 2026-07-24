import { describe, it, expect } from "vitest";
import { getMarkdownCompletions } from "./get-completions";
import type { CompletionItem } from "vscode-languageserver-types";

/** Run completions at the "|" marker in a fixture. */
function complete(fixture: string): CompletionItem[] {
  const offset = fixture.indexOf("|");
  if (offset === -1) throw new Error("fixture needs a | cursor marker");
  return getMarkdownCompletions({ text: fixture.replace("|", ""), offset });
}

const labels = (items: CompletionItem[]) => items.map((i) => i.label);
const byLabel = (items: CompletionItem[], label: string) =>
  items.find((i) => i.label === label);

describe("container directive completions", () => {
  it("offers container directives after `:::`", () => {
    expect(labels(complete(":::theo|"))).toContain("theorem");
  });

  it("expands to a full :::name … ::: skeleton", () => {
    const item = byLabel(complete(":::theo|"), "theorem");
    expect(item?.textEdit?.newText).toBe("theorem\n\t$0\n:::");
  });

  it("seeds a nested :::task for task-bearing directives", () => {
    const item = byLabel(complete(":::exerc|"), "exercise");
    expect(item?.textEdit?.newText).toContain(":::task");
  });

  it("boosts child directives of the enclosing container", () => {
    const items = complete(":::theorem\ntext\n:::pro|\n:::\n");
    const proof = byLabel(items, "proof");
    expect(proof?.sortText?.startsWith("0")).toBe(true);
  });

  it("filters by the typed prefix", () => {
    const items = complete(":::lem|");
    expect(labels(items)).toContain("lemma");
    expect(labels(items)).not.toContain("theorem");
  });
});

describe("python-style directive completions", () => {
  it("completes a bare line-start word into a `Name:` marker", () => {
    const item = byLabel(complete("Theo|"), "theorem:");
    expect(item?.textEdit?.newText).toBe("theorem:\n\t$0");
  });

  it("is case-insensitive and offers indented directives", () => {
    expect(labels(complete("exerc|"))).toContain("exercise:");
    const item = byLabel(complete("exerc|"), "exercise:");
    expect(item?.textEdit?.newText).toContain("task:");
  });

  it("boosts child directives inside a python-style parent body", () => {
    const items = complete("Theorem:\n    Statement.\n\n    Proo|\n");
    const proof = byLabel(items, "proof:");
    expect(proof?.sortText?.startsWith("0")).toBe(true);
  });

  it("stays quiet for prose that is not a directive prefix", () => {
    // "Let" prefixes no directive name, so no popup appears mid-sentence.
    expect(complete("Let|")).toEqual([]);
  });
});

describe("leaf directive completions", () => {
  it("offers include directives after `::`", () => {
    const items = complete("::sec|");
    const section = byLabel(items, "section");
    expect(section?.textEdit?.newText).toBe('section{ref="$1"}');
  });

  it("does not offer container directives after only `::`", () => {
    // `proof` is a container directive; it must not appear in leaf context.
    expect(labels(complete("::pro|"))).not.toContain("proof");
  });
});

describe("math completions", () => {
  it("switches to KaTeX macros inside math mode", () => {
    const items = complete("$ x = \\fra| $");
    expect(labels(items)).toContain("frac");
    // Directive names must not leak into math completions.
    expect(labels(items)).not.toContain("theorem");
  });
});

describe("cross-reference completions", () => {
  it("completes `](#…` against harvested ids", () => {
    const items = complete(":::theorem{#thm:main}\nHi\n:::\n\nSee [it](#thm|");
    expect(labels(items)).toContain("thm:main");
  });
});

describe("suppression", () => {
  it("suppresses completions inside fenced code", () => {
    expect(complete("```\n:::theo|\n```\n")).toEqual([]);
  });

  it("suppresses completions inside HTML comments", () => {
    expect(complete("<!-- :::theo| -->")).toEqual([]);
  });

  it("suppresses completions inside frontmatter", () => {
    expect(complete("---\ndivi|\n---\n")).toEqual([]);
  });
});
