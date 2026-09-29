// Ported from PreprocessLaTeX/src/utils.js.

export function deleteComments(input: string): string {
  let output = input;
  output = output.replace(/\s+%.*/g, "");
  output = output.replace(/([^\\])%.*/g, "$1");
  output = output.replace(/^%.*/, "");
  return output;
}

function goodLabel(match: string): string {
  return match.replace(/(.*\{)([^{}]+)(\}.*)/, (_full, head, inner, tail) => {
    const cleaned = String(inner)
      .replace(/\s/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "-");
    return `${head}${cleaned}${tail}`;
  });
}

/**
 * A beamer overlay specification and what it attaches to: a command
 * (`\item<2->`, `\only<3>`), an environment (`\begin{frame}<1-2>`), or an
 * optional argument (`\begin{itemize}[<+->]`). The spec itself holds only
 * slide numbers, ranges, and `action@` prefixes -- never a backslash or
 * brace, which keeps inequalities in math (`\alpha<\beta`) out.
 */
const OVERLAY_SPEC_RE =
  /(\\[a-zA-Z]+\*?|\\begin\{[^{}]*\}|\[)(<[\w+\-.,|@()*][\w+\-.,|@()* ]*>)/g;

export function makeXMLSafe(input: string): string {
  // Overlay specs are syntax the converter reads, not text: set them aside so
  // the `<`/`>` rewrite below cannot turn `\item<2->` into `\item\lt 2-\gt`.
  const overlays: string[] = [];
  let output = input.replace(OVERLAY_SPEC_RE, (_match, lead, spec) => {
    overlays.push(spec);
    return `${lead}\u0000${overlays.length - 1}\u0000`;
  });
  output = output.replace(/> */g, "\\gt ");
  output = output.replace(/< */g, "\\lt ");
  output = output.replace(
    /\u0000(\d+)\u0000/g,
    (_match, i) => overlays[Number(i)],
  );
  output = output.replace(
    /(\\(ref|eqref|cref|Cref|label)\{([^{}]+)\})/g,
    goodLabel,
  );
  return output;
}

export function trimJunk(input: string): string {
  let output = input;
  output = output.replace(/\\begin +/g, "\\begin");
  output = output.replace(/\\chapter +/g, "\\chapter");
  output = output.replace(/\\section +/g, "\\section");
  output = output.replace(/\\section\*/g, "\\section");
  output = deleteComments(output);
  output = makeXMLSafe(output);
  // After deleting comments, in case an \end{document} was commented out.
  output = output.replace(/\\end\{document\}.*/s, "");
  output = output.replace(/^\s+/, "");
  output = output.replace(/\n{3,}/g, "\n\n");
  return output;
}

// If `text` is of the form `{A}B`, returns ["{A}", "B"]. Otherwise returns ["", text].
// Initial whitespace is stripped from `text` before scanning.
export function firstBracketedString(
  text: string,
  depth = 0,
  lbrack = "{",
  rbrack = "}",
): [string, string] {
  let remaining = text.trimStart();
  if (!remaining) {
    return ["", ""];
  }

  let previousChar = "";
  let firstPart = "";
  let currentDepth = depth;

  if (currentDepth === 0 && remaining[0] !== lbrack) {
    return ["", remaining];
  }
  if (currentDepth === 0) {
    firstPart = lbrack;
    currentDepth = 1;
    remaining = remaining.substring(1);
  }

  while (currentDepth > 0 && remaining) {
    const currentChar = remaining[0];
    if (currentChar === lbrack && previousChar !== "\\") {
      currentDepth += 1;
    } else if (currentChar === rbrack && previousChar !== "\\") {
      currentDepth -= 1;
    }
    firstPart += currentChar;
    if (previousChar === "\\" && currentChar === "\\") {
      previousChar = "\n";
    } else {
      previousChar = currentChar;
    }
    remaining = remaining.substring(1);
  }

  if (currentDepth === 0) {
    return [firstPart, remaining];
  }
  return ["", firstPart.substring(1)];
}
