import { describe, it, expect } from "vitest";
import { scanDocument, contextAt } from "./scan-document";

/** Offset of the cursor marker "|" in a fixture, and the text with it removed. */
function cursor(fixture: string): { text: string; offset: number } {
  const offset = fixture.indexOf("|");
  if (offset === -1) throw new Error("fixture must contain a | cursor marker");
  return { text: fixture.replace("|", ""), offset };
}

function contextIn(fixture: string) {
  const { text, offset } = cursor(fixture);
  return contextAt(scanDocument(text), offset);
}

describe("directive scanning", () => {
  it("records container open/close occurrences", () => {
    const { directives } = scanDocument(":::theorem\nHi\n:::\n");
    expect(directives.map((d) => [d.name, d.type])).toEqual([
      ["theorem", "open"],
      ["", "close"],
    ]);
  });

  it("records leaf directives without opening a container", () => {
    const { directives } = scanDocument('::section{ref="ch-1"}\n');
    expect(directives).toEqual([
      expect.objectContaining({ name: "section", type: "leaf", colons: 2 }),
    ]);
  });

  it("tracks the open container stack, innermost last", () => {
    const ctx = contextIn(":::exercise\n:::task\nno|w\n:::\n:::\n");
    expect(ctx.directiveStack).toEqual(["exercise", "task"]);
    expect(ctx.currentDirective).toBe("task");
  });

  it("pops the innermost container on a closing fence", () => {
    const ctx = contextIn(":::exercise\n:::task\n:::\naf|ter\n:::\n");
    expect(ctx.directiveStack).toEqual(["exercise"]);
  });

  it("does not count a container whose open line straddles the cursor", () => {
    const ctx = contextIn(":::theo|rem\n");
    expect(ctx.directiveStack).toEqual([]);
  });

  it("pairs a colon fence only when open/close counts match", () => {
    // The `:::` cannot close the `::::theorem`, so it stays open at the cursor.
    const ctx = contextIn("::::theorem\n:::\naf|ter\n");
    expect(ctx.directiveStack).toEqual(["theorem"]);
  });

  it("closes a deeper-nested fence with its matching count", () => {
    const ctx = contextIn("::::exercise\n:::task\n:::\nno|w\n::::\n");
    expect(ctx.directiveStack).toEqual(["exercise"]);
  });
});

describe("python-style indented directives", () => {
  it("opens a directive from a `Name:` marker with an indented body", () => {
    const ctx = contextIn("Theorem:\n    Let $x$ be re|al.\n");
    expect(ctx.currentDirective).toBe("theorem");
  });

  it("nests by indentation and closes on dedent", () => {
    const doc =
      "Theorem:\n    Statement.\n\n    Proof:\n        deep| inside\n\nPlain text.\n";
    expect(contextIn(doc).directiveStack).toEqual(["theorem", "proof"]);
  });

  it("closes python directives once content outdents", () => {
    const doc = "Theorem:\n    Statement.\n\nPlain te|xt.\n";
    expect(contextIn(doc).directiveStack).toEqual([]);
  });

  it("ignores a `Name:` line with no indented body", () => {
    // No deeper body, so this is ordinary prose, not a directive.
    const ctx = contextIn("Theorem:\nNext li|ne at same indent.\n");
    expect(ctx.directiveStack).toEqual([]);
  });

  it("ignores a `Name:` line whose name is not a directive", () => {
    const ctx = contextIn("Summary:\n    some indented te|xt\n");
    expect(ctx.directiveStack).toEqual([]);
  });
});

describe("math-mode detection", () => {
  it("is math inside $...$", () => {
    expect(contextIn("text $x + |y$ more").mode).toBe("math");
  });

  it("is text outside inline math", () => {
    expect(contextIn("text $x$ mo|re").mode).toBe("text");
  });

  it("handles \\(...\\) and \\[...\\] and multi-line $$", () => {
    expect(contextIn("a \\( x |y \\) b").mode).toBe("math");
    expect(contextIn("$$\nx = |1\n$$\n").mode).toBe("math");
  });

  it("treats an escaped dollar as literal, not math", () => {
    expect(contextIn("costs \\$5 and is fi|ne").mode).toBe("text");
  });
});

describe("code, comment, and frontmatter suppression", () => {
  it("marks offsets inside a fenced code block", () => {
    const ctx = contextIn("```\n:::theorem still co|de\n```\n");
    expect(ctx.inCode).toBe(true);
    // A `:::` inside code must not open a directive.
    expect(ctx.directiveStack).toEqual([]);
  });

  it("does not open math from a $ inside fenced code", () => {
    expect(contextIn("```\nprice $5\n```\nplain te|xt").mode).toBe("text");
  });

  it("flags offsets inside an HTML comment, including its trailing edge", () => {
    expect(contextIn("text <!-- a comment wi|th $x$ -->\n").inComment).toBe(
      true,
    );
    expect(
      contextIn("text <!-- multi\nline com|ment\n--> after").inComment,
    ).toBe(true);
  });

  it("marks offsets inside YAML frontmatter", () => {
    const ctx = contextIn("---\ntitle: My Bo|ok\n---\n# Chapter\n");
    expect(ctx.inFrontmatter).toBe(true);
  });
});

describe("id harvesting", () => {
  it("harvests ids from directive attributes and headings", () => {
    const { labels } = scanDocument(
      ":::theorem{#thm:main}\nHi\n:::\n\n## Intro {#sec:intro}\n",
    );
    expect(labels.map((l) => l.name)).toEqual(["thm:main", "sec:intro"]);
  });

  it("harvests xml:id / label attribute forms and frontmatter", () => {
    const { labels } = scanDocument(
      '---\nxmlid: root-id\n---\n::section{ref="x" label=lbl-1}\n',
    );
    expect(labels.map((l) => l.name)).toContain("root-id");
    expect(labels.map((l) => l.name)).toContain("lbl-1");
  });
});
