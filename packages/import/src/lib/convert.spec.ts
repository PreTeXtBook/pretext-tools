import { describe, expect, it } from "vitest";
import { convertLatexToPretext } from "./convert";

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
