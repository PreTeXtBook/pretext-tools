import type { EnvironmentSpec, MacroSpec } from "../types";

/**
 * The text inserted when completing an environment name, assuming the caller
 * has already typed `\begin{` (or `\end{`). Includes the closing `}` of the
 * name, a body, and the matching `\end{...}`. Uses LSP snippet syntax.
 *
 * The body defaults to a single indented tab stop; a spec may override it via
 * `snippet` (e.g. `enumerate` seeds an `\item`, `tabular` a column spec). An
 * override is the body only — the `\begin`/`\end` framing is always supplied
 * here so the two can never drift out of sync.
 */
export function environmentInsertText(spec: EnvironmentSpec): string {
  const body = spec.snippet ?? "\n\t$0\n";
  return `${spec.name}}${body}\\end{${spec.name}}`;
}

/** The `\end{...}` completion body, assuming `\end{` is already typed. */
export function endInsertText(name: string): string {
  return `${name}}`;
}

/**
 * The text inserted when completing a macro, assuming the caller has already
 * typed the leading `\`. Derives argument placeholders from the spec's
 * signature unless the spec supplies a bespoke `snippet`.
 */
export function macroInsertText(spec: MacroSpec): string {
  if (spec.snippet) return spec.snippet;
  const tokens = spec.signature.split(" ").filter(Boolean);
  if (tokens.length === 0) return spec.name;
  let n = 0;
  const args = tokens
    .map((tok) => {
      n++;
      return tok === "o" ? `[$${n}]` : `{$${n}}`;
    })
    .join("");
  return `${spec.name}${args}`;
}
