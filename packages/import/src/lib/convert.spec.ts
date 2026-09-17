import { describe, expect, it } from "vitest";
import { convertLatexToPretext, convertSourceToPretext } from "./convert";
import { detectDocumentKind } from "./layout/document-kind";

describe("convertLatexToPretext", () => {
  it("escapes XML-special characters in preamble macros", () => {
    const latex = String.raw`
\documentclass{article}
\newcommand{\lt}{<}
\newcommand{\amp}{\&}
\begin{document}
Hello world.
\end{document}
`;

    const { pretext } = convertLatexToPretext(latex);

    const macrosMatch = /<macros>([\s\S]*?)<\/macros>/.exec(pretext);
    expect(macrosMatch).not.toBeNull();
    const macrosBody = macrosMatch![1];

    // `\def\<{...}` and `\&` must be entity-escaped: a bare `<` or `&` in
    // this text node would make the assembled document malformed XML,
    // which previously truncated the docinfo mid-command.
    expect(macrosBody).toContain("&lt;");
    expect(macrosBody).toContain("&amp;");
    const withoutEntities = macrosBody.replace(/&(amp|lt|gt);/g, "");
    expect(withoutEntities).not.toContain("<");
    expect(withoutEntities).not.toContain("&");
  });

  it("keeps \\def macros in <macros> and warns that they won't convert", () => {
    const latex = String.raw`
\documentclass{article}
\def\R{\mathbb{R}}
\begin{document}
Hello world.
\end{document}
`;

    const { pretext, warnings } = convertLatexToPretext(latex);

    expect(pretext).toContain("\\def\\R{\\mathbb{R}}");
    expect(warnings).toContainEqual(
      expect.objectContaining({ macro: "def", action: "anomaly" }),
    );
  });
});

describe("slideshow imports", () => {
  const beamer = [
    "\\documentclass{beamer}",
    "\\title{My Talk}",
    "\\begin{document}",
    "\\maketitle",
    "\\begin{frame}{First Slide}",
    "Hello world.",
    "\\end{frame}",
    "\\begin{frame}",
    "\\frametitle{Second}",
    "More.",
    "\\end{frame}",
    "\\end{document}",
  ].join("\n");

  it("wraps a beamer document in <slideshow>, not <article>", () => {
    const result = convertSourceToPretext(beamer);
    expect("pretextError" in result).toBe(false);
    if ("pretextError" in result) return;
    // <slide> is legal only inside <slideshow>, so the old <article> wrapper
    // produced a document no schema would accept.
    expect(result.pretextSource).toContain("<slideshow>");
    expect(result.pretextSource).not.toContain("<article>");
    expect(detectDocumentKind(result.pretextSource)).toBe("slideshow");
  });

  it("uses <slideshow> when frames appear under a non-beamer class", () => {
    const result = convertSourceToPretext(
      beamer.replace("{beamer}", "{article}"),
    );
    if ("pretextError" in result) throw new Error(result.pretextError);
    expect(result.pretextSource).toContain("<slideshow>");
  });

  it("leaves an ordinary article alone", () => {
    const result = convertSourceToPretext(
      "\\documentclass{article}\n\\begin{document}\nHi.\n\\end{document}",
    );
    if ("pretextError" in result) throw new Error(result.pretextError);
    expect(result.pretextSource).toContain("<article>");
    expect(result.pretextSource).not.toContain("<slideshow>");
  });

  it("maps markdown headings to section/slide when asked for a slideshow", () => {
    const md = "# Part One\n\n## Slide A\n\ntext a\n\n## Slide B\n\ntext b\n";
    const result = convertSourceToPretext(md, "markdown", "slideshow");
    if ("pretextError" in result) throw new Error(result.pretextError);
    expect(result.pretextSource).toContain("<slideshow>");
    expect(result.pretextSource).toContain("<slide>");
    // Under the slideshow hierarchy `##` is a slide, never a subsection.
    expect(result.pretextSource).not.toContain("<subsection>");
  });

  it("honours `division: slideshow` frontmatter with no explicit kind", () => {
    const md =
      "---\ndivision: slideshow\ntitle: Deck\n---\n\n# Part\n\n## Slide A\n\ntext\n";
    const result = convertSourceToPretext(md, "markdown");
    if ("pretextError" in result) throw new Error(result.pretextError);
    expect(detectDocumentKind(result.pretextSource)).toBe("slideshow");
  });

  it("markdown without a slideshow kind still builds sections", () => {
    const md = "# Part One\n\n## Sub\n\ntext\n";
    const result = convertSourceToPretext(md, "markdown");
    if ("pretextError" in result) throw new Error(result.pretextError);
    expect(result.pretextSource).not.toContain("<slide>");
  });
});
