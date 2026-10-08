/**
 * Whether converted markup belongs at an insertion point, and in what shape
 * (SPEC §9.5).
 *
 * `detectSnippetFormat` asks whether a snippet is LaTeX or Markdown. This asks
 * the question that has to come first: would converted markup belong *here*?
 * Inside `<latex-image>` the TikZ an author pastes is the content itself; inside
 * `<m>` the LaTeX is already where it goes; inside a comment, a CDATA section or
 * an attribute value there is no markup to produce at all. Converting in any of
 * those places mangles exactly the text that was right as it was.
 *
 * The same scan answers the placement question — running text or between
 * blocks? — so whether to convert and how to fit the result cannot disagree.
 */
import { defaultDevSchema } from "@pretextbook/completions";
import { verbatimTags } from "@pretextbook/format";
import {
  MATH_ELEMENTS,
  scanXmlContext,
  type OpenElement,
} from "@pretextbook/typing-shortcuts";

export interface PasteTarget {
  /**
   * Why converted markup does not belong at the insertion point, or undefined
   * when it does — for the host to log, since the paste then goes in plainly.
   */
  literal?: string;
  /** The insertion point is in running text, where only inline markup fits. */
  inline: boolean;
}

const schema = defaultDevSchema.elementChildren;

function admits(element: string, child: string): boolean {
  return schema[element]?.elements.includes(child) ?? false;
}

/**
 * Elements whose text is never PreTeXt markup, however deeply nested: LaTeX
 * math, and code or other content kept verbatim.
 *
 * These are lists rather than schema lookups because the schema cannot say it.
 * `<md>` admits `<xref>` and `<intertext>`, which hold markup, yet the text of
 * an `<mrow>` is LaTeX; `<program>` admits `<checkpoint>`, yet code pasted into
 * it is code. Both lists are the ones their own packages maintain — the math
 * the typing shortcuts already refuse to rewrite, and the elements the
 * formatter already refuses to reflow — so a paste agrees with both.
 */
const LITERAL_ELEMENTS: ReadonlySet<string> = new Set([
  ...MATH_ELEMENTS,
  ...verbatimTags,
]);

let markupBearing: ReadonlySet<string> | undefined;

/**
 * Elements that can hold markup somewhere inside them: those that admit `<p>`
 * or `<m>`, and — so that a `<book>` between chapters or a `<definition>`
 * before its `<statement>` still counts — those with a child that can.
 * Everything else in the schema holds plain text or nothing at all.
 *
 * Built on first use rather than at load, so a host that never pastes does not
 * pay for walking the schema.
 */
function markupBearingElements(): ReadonlySet<string> {
  if (markupBearing) {
    return markupBearing;
  }
  const names = Object.keys(schema);
  const bearing = new Set(
    names.filter((name) => admits(name, "p") || admits(name, "m")),
  );
  // To a fixed point: a container counts once any child of it does.
  let grew = true;
  while (grew) {
    grew = false;
    for (const name of names) {
      if (
        !bearing.has(name) &&
        schema[name].elements.some((child) => bearing.has(child))
      ) {
        bearing.add(name);
        grew = true;
      }
    }
  }
  markupBearing = bearing;
  return bearing;
}

/** Why the innermost element cannot take converted markup, if it cannot. */
function literalElementReason(open: OpenElement[]): string | undefined {
  // Any ancestor will do: nothing nested in `<latex-image>` or `<m>` is markup.
  for (let i = open.length - 1; i >= 0; i--) {
    const { name } = open[i];
    if (MATH_ELEMENTS.has(name)) {
      return `the cursor is inside <${name}>, which holds LaTeX already`;
    }
    if (LITERAL_ELEMENTS.has(name)) {
      return `the cursor is inside <${name}>, whose content is kept verbatim`;
    }
  }

  // Only the innermost element is consulted here. The generated content
  // models are not complete (a few elements come through with none at all),
  // so trusting them about an ancestor could switch conversion off for
  // everything beneath it.
  const innermost = open[open.length - 1];
  if (!innermost) {
    return undefined;
  }
  if (!(innermost.name in schema)) {
    // Prefigure diagrams, DoenetML, a typo: not PreTeXt, so not ours to write.
    return `the cursor is inside <${innermost.name}>, which is not a PreTeXt element`;
  }
  if (!markupBearingElements().has(innermost.name)) {
    return `the cursor is inside <${innermost.name}>, which cannot hold markup`;
  }
  return undefined;
}

/**
 * Whether the insertion point is in running text.
 *
 * The schema decides wherever it can: an element that admits `<m>` but not
 * `<p>` — a `<title>`, a `<caption>`, a `<p>` itself — takes inline markup, and
 * one that admits `<p>` but not `<m>` takes paragraphs. For the few that admit
 * both (`<li>`, `<cell>`, `<description>`), and for containers that admit
 * neither, it falls back to whether a `<p>` is open, as `isInlineContext` does.
 */
function isRunningText(open: OpenElement[]): boolean {
  const innermost = open[open.length - 1]?.name;
  if (innermost !== undefined) {
    const paragraphs = admits(innermost, "p");
    const math = admits(innermost, "m");
    if (math && !paragraphs) return true;
    if (paragraphs && !math) return false;
  }
  return open.some((element) => element.name === "p");
}

/**
 * What the insertion point will take, given `prefix` — the document text up
 * to it.
 *
 * Read by walking tags rather than parsing, because the document is mid-edit
 * and often not well-formed; see `scanXmlContext`.
 */
export function pasteTargetAt(prefix: string): PasteTarget {
  const context = scanXmlContext(prefix, prefix.length);
  const inline = isRunningText(context.open);
  if (!context.inText) {
    return {
      literal: "the cursor is inside a tag, a comment or a CDATA section",
      inline,
    };
  }
  return { literal: literalElementReason(context.open), inline };
}
