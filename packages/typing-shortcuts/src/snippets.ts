/**
 * Resolve snippet syntax to plain text, for a host without a snippet engine:
 * placeholders keep their text (`${1:x}` → `x`, `${1|a,b|}` → `a`), bare tab
 * stops vanish, and `caret` is the offset of the first tab stop (`$1`, else
 * `$0`, else the end).
 */
export const snippetToPlainText = (
  snippet: string,
): { text: string; caret: number } => {
  const stops = new Map<number, number>();
  let text = "";
  const record = (n: number) => {
    if (!stops.has(n)) stops.set(n, text.length);
  };

  let i = 0;
  while (i < snippet.length) {
    const ch = snippet[i];
    if (
      ch === "\\" &&
      i + 1 < snippet.length &&
      "$\\}".includes(snippet[i + 1])
    ) {
      text += snippet[i + 1];
      i += 2;
      continue;
    }
    if (ch === "$") {
      const bare = /^\$(\d+)/.exec(snippet.slice(i));
      if (bare) {
        record(Number(bare[1]));
        i += bare[0].length;
        continue;
      }
      const braced = /^\$\{(\d+)(?::([^}]*)|\|([^|]*)\||\/[^}]*)?\}/.exec(
        snippet.slice(i),
      );
      if (braced) {
        record(Number(braced[1]));
        text += braced[2] ?? braced[3]?.split(",")[0] ?? "";
        i += braced[0].length;
        continue;
      }
    }
    text += ch;
    i++;
  }

  const numbered = [...stops.keys()].filter((n) => n > 0).sort((a, b) => a - b);
  const first = numbered.length > 0 ? numbered[0] : 0;
  return { text, caret: stops.get(first) ?? text.length };
};
