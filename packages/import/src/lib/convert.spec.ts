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

  it("builds the title slide's <frontmatter> from the preamble", () => {
    const deck = [
      "\\documentclass{beamer}",
      "\\title[Short]{My Talk}",
      "\\subtitle{A first look}",
      "\\author{Ada\\inst{1} \\and Alan\\inst{2}}",
      "\\institute{\\inst{1}Univ One \\and \\inst{2}Univ Two}",
      "\\date{May 2026}",
      "\\newcommand{\\R}{\\mathbb{R}}",
      "\\begin{document}",
      "\\begin{frame}",
      "\\titlepage",
      "\\end{frame}",
      "\\begin{frame}{First}",
      "Hello.",
      "\\end{frame}",
      "\\end{document}",
    ].join("\n");
    const result = convertSourceToPretext(deck);
    if ("pretextError" in result) throw new Error(result.pretextError);
    const source = result.pretextSource.replace(/\s+/g, " ");
    expect(source).toContain(
      "<title>My Talk</title> <subtitle>A first look</subtitle> <shorttitle>Short</shorttitle> <frontmatter> <bibinfo>",
    );
    expect(source).toContain(
      "<author> <personname>Ada</personname> <institution>Univ One</institution> </author>",
    );
    expect(source).toContain(
      "<author> <personname>Alan</personname> <institution>Univ Two</institution> </author>",
    );
    expect(source).toContain("<date>May 2026</date>");
    expect(source).toContain("<titlepage> <titlepage-items/> </titlepage>");
    // The title frame is the generated title slide, not a slide of its own.
    expect(source).not.toContain("titlepage}");
    expect(source).toContain("</frontmatter> <slide> <title>First</title>");
    // The authors live in the frontmatter; the docinfo keeps the macros.
    expect(source).toMatch(/<docinfo> <macros>[^<]*\\R/);
    expect(source).not.toMatch(/<docinfo>.*<author>.*<\/docinfo>/);
  });

  it("carries beamer's reveals over as pauses", () => {
    const deck = [
      "\\documentclass{beamer}",
      "\\begin{document}",
      "\\begin{frame}{Reveals}",
      "First. \\pause Second.",
      "",
      "\\begin{itemize}[<+->]",
      "\\item A",
      "\\item B",
      "\\end{itemize}",
      "",
      "\\begin{enumerate}",
      "\\item<1-> One",
      "\\item<2-> Two",
      "\\end{enumerate}",
      "\\end{frame}",
      "\\end{document}",
    ].join("\n");
    const result = convertSourceToPretext(deck);
    if ("pretextError" in result) throw new Error(result.pretextError);
    const source = result.pretextSource;
    // Everything after the `\pause` is one step: the rest of the paragraph
    // and both lists, which then reveal their own items one at a time.
    expect(source).toMatch(
      /<p>\s*First\.\s*<\/p>\s*<subslide>\s*<p>\s*Second\./,
    );
    expect(source).toContain('<ul pause="yes">');
    expect(source).toContain('<ol pause="yes">');
    // Overlay specs reach the converter intact, not as `\lt ... \gt`.
    expect(source).not.toContain("\\lt");
    expect(source).not.toContain("TODO");
  });

  it("drops an outline frame instead of leaving an empty slide", () => {
    const deck = [
      "\\documentclass{beamer}",
      "\\begin{document}",
      "\\begin{frame}{Outline}",
      "\\tableofcontents",
      "\\end{frame}",
      "\\begin{frame}{Real}",
      "Content.",
      "\\end{frame}",
      "\\end{document}",
    ].join("\n");
    const result = convertSourceToPretext(deck);
    if ("pretextError" in result) throw new Error(result.pretextError);
    expect(result.pretextSource).not.toContain("Outline");
    expect(result.pretextSource).toContain("<title>Real</title>");
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
