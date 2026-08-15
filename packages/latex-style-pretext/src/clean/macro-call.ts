// Locates the full extent of a macro call: the control word, its arguments, and
// where each argument's content sits.
//
// The cleaning rules match only the control word (`\textbf`), which is all a
// substitution needs — swapping `\textbf` for `\alert` leaves the braces alone.
// Removing a macro needs more: deleting it outright has to take `{…}` with it,
// and unwrapping it has to put the braces' contents back in its place. Both
// require knowing where the call ends.

import { MACRO_BY_NAME } from "../data/macros";

export interface MacroArgumentSpan {
  /** Offset of the first character inside the delimiters. */
  start: number;
  /** Offset just past the last character inside the delimiters. */
  end: number;
}

export interface MacroCall {
  /** Macro name, without the backslash. */
  name: string;
  /** Offset of the backslash. */
  start: number;
  /** Offset just past the control word (before any arguments). */
  nameEnd: number;
  /** Offset just past the last argument — equals `nameEnd` when there are none. */
  end: number;
  /** Content of each mandatory argument, delimiters excluded. */
  mandatoryArguments: MacroArgumentSpan[];
}

function isLetter(ch: string | undefined): boolean {
  return (
    ch !== undefined && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z"))
  );
}

/**
 * Read a balanced delimited group starting at `open`, returning the offset just
 * past its closing delimiter. Honours `\{` and friends, so an escaped brace in
 * the argument does not end it early.
 */
function readBalanced(
  text: string,
  from: number,
  open: string,
  close: string,
): number | null {
  if (text[from] !== open) return null;
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

/**
 * Parse the macro call whose backslash is at `start`.
 *
 * Arguments are read according to the macro's curated signature rather than by
 * grabbing every following brace group: `\textbf{a}{b}` is a one-argument macro
 * followed by an ordinary group, and consuming both would delete text the author
 * never marked up.
 *
 * A macro used as a plain switch (`{\textbf ...}`, no braces of its own) parses
 * with no arguments and `end === nameEnd`, which is the honest answer — there is
 * nothing to unwrap.
 */
export function readMacroCall(text: string, start: number): MacroCall | null {
  if (text[start] !== "\\") return null;
  let i = start + 1;
  while (isLetter(text[i])) i += 1;
  if (i === start + 1) return null;

  const name = text.slice(start + 1, i);
  const nameEnd = i;
  const signature = MACRO_BY_NAME.get(name)?.signature ?? "m";
  const mandatoryArguments: MacroArgumentSpan[] = [];
  let end = nameEnd;

  for (const token of signature.split(/\s+/).filter(Boolean)) {
    let cursor = end;
    while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor += 1;

    if (token === "s") {
      if (text[cursor] === "*") end = cursor + 1;
      continue;
    }

    if (token === "o") {
      // An optional argument that is not there is not an error — skip it and
      // keep looking for the mandatory ones behind it (`\worksheet*{Title}`).
      const closed = readBalanced(text, cursor, "[", "]");
      if (closed !== null) end = closed;
      continue;
    }

    const closed = readBalanced(text, cursor, "{", "}");
    // A missing or unbalanced mandatory argument stops the scan: whatever
    // follows is not this macro's, and guessing would put the removal range
    // past the damage.
    if (closed === null) break;
    mandatoryArguments.push({ start: cursor + 1, end: closed - 1 });
    end = closed;
  }

  return { name, start, nameEnd, end, mandatoryArguments };
}

/** Replacement text that removes the macro and everything it wraps. */
export function deleteMacroText(): string {
  return "";
}

/**
 * Replacement text that removes the macro but keeps what it wrapped, so
 * `\textbf{bold words}` becomes `bold words`.
 */
export function unwrapMacroText(text: string, call: MacroCall): string {
  return call.mandatoryArguments
    .map((arg) => text.slice(arg.start, arg.end))
    .join("");
}

/**
 * True when deleting and unwrapping would do the same thing — a macro with no
 * arguments to keep. Offering both would be two labels for one edit.
 */
export function removalsAreEquivalent(call: MacroCall): boolean {
  return call.mandatoryArguments.length === 0;
}
