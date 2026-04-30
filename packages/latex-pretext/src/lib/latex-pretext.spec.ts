import { describe, expect, it } from "vitest";
import { latexToPretext } from "./latex-pretext";
import { ptxastFromXml } from "@pretextbook/ptxast-util-from-xml";
import { collectPtxSchemaViolations } from "@pretextbook/ptxast";

function countNodeTypes(root: ReturnType<typeof ptxastFromXml>) {
  const counts = new Map<string, number>();
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const current = stack.pop() as { type?: unknown; children?: unknown };
    if (!current || typeof current !== "object") continue;

    if (typeof current.type === "string") {
      counts.set(current.type, (counts.get(current.type) ?? 0) + 1);
    }

    if (Array.isArray(current.children)) {
      for (let i = current.children.length - 1; i >= 0; i -= 1) {
        stack.push(current.children[i]);
      }
    }
  }

  return counts;
}

function normalizeLatexXmlForParsing(xml: string): string {
  const trimmed = xml.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed;
  }

  // unified-latex may emit inline mixed-content fragments for plain text input.
  return `<p>${trimmed}</p>`;
}

describe("latexToPretext", () => {
  it("converts inline math to PreTeXt m tags", () => {
    const out = String(latexToPretext("Let $x^2+1$.").value);
    expect(out).toContain("<m>");
    expect(out).toContain("</m>");
    expect(out).toContain("x^{2}+1");
  });

  it("converts theorem environments to theorem/statement structure", () => {
    const out = String(
      latexToPretext("\\begin{theorem}A thing.\\end{theorem}").value,
    );

    expect(out).toContain("<theorem>");
    expect(out).toContain("<statement>");
    expect(out).toContain("<p>A thing.</p>");
    expect(out).toContain("</statement>");
    expect(out).toContain("</theorem>");
  });

  it("converts section headings to section/title structure", () => {
    const out = String(latexToPretext("\\section{Intro} Body text.").value);

    expect(out).toContain("<section>");
    expect(out).toContain("<title>Intro</title>");
    expect(out).toContain("Body text.");
    expect(out).toContain("</section>");
  });

  it("produces structurally parseable output for representative LaTeX fixtures", () => {
    const fixtures = [
      {
        name: "inline math paragraph",
        latex: "Let $x^2+1$.",
        expected: new Map([
          ["root", 1],
          ["p", 1],
          ["m", 1],
        ]),
      },
      {
        name: "theorem environment",
        latex: "\\begin{theorem}A thing.\\end{theorem}",
        expected: new Map([
          ["root", 1],
          ["theorem", 1],
          ["statement", 1],
          ["p", 1],
        ]),
      },
      {
        name: "section heading",
        latex: "\\section{Intro} Body text.",
        expected: new Map([
          ["root", 1],
          ["section", 1],
          ["title", 1],
          ["text", 2],
        ]),
      },
    ];

    for (const fixture of fixtures) {
      const xml = String(latexToPretext(fixture.latex).value);
      const normalized = normalizeLatexXmlForParsing(xml);
      const parsed = ptxastFromXml(normalized);
      const counts = countNodeTypes(parsed);

      for (const [nodeType, expectedCount] of fixture.expected) {
        expect(
          counts.get(nodeType),
          `${fixture.name}: expected ${expectedCount} ${nodeType} node(s)`,
        ).toBe(expectedCount);
      }

      const violations = collectPtxSchemaViolations(parsed);
      expect(
        violations,
        `${fixture.name}: schema warnings found\n${violations.join("\n")}`,
      ).toEqual([]);
    }
  });
});
