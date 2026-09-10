/**
 * Fitting converted markup to the place it is going (SPEC §9.5).
 *
 * Conversion answers "what is this LaTeX in PreTeXt?"; this answers "and what
 * has to change for it to sit *here*?" — unwrapping a paragraph the insertion
 * point is already inside, wrapping loose text in one when it is not, matching
 * the surrounding indentation, and saying so when the two cannot be reconciled.
 *
 * Both questions are pure string problems, which is why they live here rather
 * than in a host: the VS Code paste provider and pretext-plus's Monaco binding
 * ask exactly the same one, and a second copy of these rules would drift from
 * the converters they follow.
 */
import { findTopLevelElementsMatching } from "../layout/xml-scan";
import { PRETEXT_DIVISION_TAGS } from "../pretext-divisions";

const P_TAG = /<(\/?)p(?=[\s>/])/g;

/**
 * Is `prefix` — the document text up to the insertion point — inside a `<p>`?
 *
 * Counted by walking the paragraph tags rather than parsing, because the
 * document is mid-edit and frequently not well-formed. Only the depth matters,
 * so a stray unclosed tag degrades to "treat it as block context", which is the
 * safer of the two guesses.
 */
export function isInlineContext(prefix: string): boolean {
  let depth = 0;
  P_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = P_TAG.exec(prefix)) !== null) {
    depth += match[1] ? -1 : 1;
  }
  return depth > 0;
}

const DIVISION_TAG_PATTERN = new RegExp(
  `<(${PRETEXT_DIVISION_TAGS.join("|")})(?=[\\s>/])`,
);

/** The first division element in `markup`, if it has one. */
export function firstDivisionTag(markup: string): string | undefined {
  return DIVISION_TAG_PATTERN.exec(markup)?.[1];
}

/**
 * Prepend baseIndent to every non-empty line of text.
 * When skipFirst is true (the insertion starts mid-line), the first line is
 * left as-is because the editor places it after the existing content there.
 */
export function reindentForContext(
  text: string,
  baseIndent: string,
  skipFirst: boolean,
): string {
  return text
    .split("\n")
    .map((line, i) =>
      i === 0 && skipFirst ? line : line ? baseIndent + line : line,
    )
    .join("\n");
}

/**
 * What the PreTeXt schema allows inside a `<p>` — the children of `p` in
 * `packages/completions/src/default-dev-schema.ts`, which is generated from
 * the official RNG. Everything else is content that sits *beside* paragraphs,
 * so it ends whichever paragraph is being accumulated rather than joining it.
 *
 * Taking the list from the schema rather than writing one out by hand is what
 * makes `wrapLooseParagraphs` safe on markup nobody anticipated: the question
 * "may this element go in a `<p>`?" has exactly one right answer, and it is
 * not one this file gets to invent. `place-markup.spec.ts` fails if the two
 * drift apart.
 *
 * Four tags the schema lists are deliberately absent, because each also names
 * a block-level element and it is that meaning a converter emits at top level:
 * `<webwork>` and `<prefigure>` (block versions of the inline references),
 * `<notation>` (a notation-list entry), and `<pretext>` (the document root,
 * not the logo). Misfiling one of those as paragraph content would bury a
 * block inside a `<p>`; misfiling it the other way only leaves it alone.
 */
const PARAGRAPH_CONTENT_TAGS: ReadonlySet<string> = new Set(
  `abbr acro ad alert am angles articletitle attr bc c ca cd chord copyleft
   copyright custom dataurl dblbrackets dblprime degree delete dl doubleflat
   doublesharp eg ellipsis em email etal etc fillin flat fn foreign icon idx
   ie init insert kbd langle latex ldblbracket line lq lsq m md mdash midpoint
   minus n natural nb nbsp ndash obelus ol permille pf phonomark pilcrow
   plusminus pm prime ps pubtitle q quantity rangle rdblbracket registered rq
   rsq scaledeg section-mark servicemark sharp solidus sq stale swungdash tag
   tage taxon term tex timeofday times timesignature today trademark ul url
   var viz vs xelatex xetex xref`
    .trim()
    .split(/\s+/),
);

/** Tags dropped from the generated `<p>` content model, and why — see above. */
export const PARAGRAPH_CONTENT_EXCLUSIONS: readonly string[] = [
  "notation",
  "prefigure",
  "pretext",
  "webwork",
];

/**
 * One top-level piece of the converted markup, kept as its exact source text
 * so that reassembling the pieces cannot perturb anything it did not mean to.
 */
type Segment =
  /** Character data. `meaningful` is false for pure whitespace. */
  | { kind: "text"; text: string; meaningful: boolean }
  /** An XML comment, which belongs to neither the paragraph nor the block. */
  | { kind: "comment"; text: string }
  /** An element, with whether the schema lets it live inside a `<p>`. */
  | { kind: "element"; text: string; paragraphContent: boolean };

const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/** Split a run of character data into its text and comment pieces. */
function pushCharacterData(segments: Segment[], gap: string): void {
  COMMENT_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = COMMENT_PATTERN.exec(gap)) !== null) {
    if (match.index > cursor) {
      pushText(segments, gap.slice(cursor, match.index));
    }
    segments.push({ kind: "comment", text: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < gap.length) {
    pushText(segments, gap.slice(cursor));
  }
}

function pushText(segments: Segment[], text: string): void {
  segments.push({ kind: "text", text, meaningful: /\S/.test(text) });
}

/** Break `markup` into its top-level segments, in source order. */
function segmentTopLevel(markup: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const element of findTopLevelElementsMatching(markup, () => true)) {
    if (element.start > cursor) {
      pushCharacterData(segments, markup.slice(cursor, element.start));
    }
    segments.push({
      kind: "element",
      text: element.outer,
      paragraphContent: PARAGRAPH_CONTENT_TAGS.has(element.name),
    });
    cursor = element.end;
  }
  if (cursor < markup.length) {
    pushCharacterData(segments, markup.slice(cursor));
  }
  return segments;
}

/** Whitespace and comments belong to neither side of a paragraph boundary. */
function isNeutral(segment: Segment): boolean {
  return (
    segment.kind === "comment" ||
    (segment.kind === "text" && !segment.meaningful)
  );
}

/**
 * Emit one run of paragraph-level content, wrapped in `<p>` if it has anything
 * in it that needs a paragraph. Whitespace and comments at either end stay
 * outside the tags, so the line structure the converter produced survives and a
 * comment does not get swallowed into prose it was written above.
 */
function renderParagraphRun(run: Segment[]): string {
  const joined = run.map((segment) => segment.text).join("");
  if (!run.some((segment) => !isNeutral(segment))) {
    return joined;
  }

  let first = 0;
  let last = run.length;
  while (first < last && isNeutral(run[first])) first += 1;
  while (last > first && isNeutral(run[last - 1])) last -= 1;

  const before = run
    .slice(0, first)
    .map((s) => s.text)
    .join("");
  const core = run
    .slice(first, last)
    .map((s) => s.text)
    .join("");
  const after = run
    .slice(last)
    .map((s) => s.text)
    .join("");

  // The first and last segments may still carry whitespace of their own
  // (`"\n  Hello\n"`), which reads better outside the tags than in them.
  const leading = /^\s*/.exec(core)![0];
  const trailing = /\s*$/.exec(core)![0];
  const body = core.slice(leading.length, core.length - trailing.length);

  return `${before}${leading}<p>${body}</p>${trailing}${after}`;
}

/**
 * Wrap every run of loose paragraph content in `markup` in a `<p>`.
 *
 * Converters do not always do this themselves. `unified-latex`'s PreTeXt
 * conversion wraps paragraphs only when the source has more than one of them,
 * so pasting a single paragraph — the commonest paste there is — yields bare
 * text, and pasting `Intro \begin{theorem}…\end{theorem} outro` yields text on
 * either side of a block with no paragraph around either. Both are invalid
 * where the insertion point is not already inside a `<p>`.
 *
 * The rule is the schema's: content that may sit inside a `<p>` accumulates
 * into one, and content that may not ends the run and passes through untouched.
 * A run is only given a `<p>` if it holds real text or an element — a run of
 * whitespace and comments between two blocks is left as it was. Markup that is
 * already correctly wrapped therefore comes through unchanged, which is what
 * lets this run unconditionally on the block-context path.
 */
export function wrapLooseParagraphs(markup: string): string {
  const out: string[] = [];
  let run: Segment[] = [];

  const flush = () => {
    if (run.length > 0) {
      out.push(renderParagraphRun(run));
      run = [];
    }
  };

  for (const segment of segmentTopLevel(markup)) {
    if (segment.kind === "element" && !segment.paragraphContent) {
      flush();
      out.push(segment.text);
    } else {
      run.push(segment);
    }
  }
  flush();

  return out.join("");
}

export interface PlacementContext {
  /** The insertion point sits inside a `<p>`, so only inline content fits. */
  inline: boolean;
  /** Indentation of the line the insertion starts on. */
  baseIndent: string;
  /** The insertion starts partway along a line, after existing content. */
  midLine: boolean;
}

export interface PlacedMarkup {
  markup: string;
  /** Something the author should know about — reported by the caller. */
  warning?: string;
}

/**
 * Fit markup to an insertion point that is already inside a `<p>`.
 *
 * The converter's own wrapping `<p>` is one paragraph too many, so it comes
 * off — but only when the whole of `markup` is that one paragraph. A lazy
 * regex will happily "unwrap" `<p>A</p><p>B</p>` down to `A</p><p>B`, which is
 * the one outcome worse than leaving it alone.
 *
 * Whatever is left is measured against the same `<p>` content model the
 * block path wraps by. A top-level element the schema does not allow in a
 * paragraph cannot be repaired from here — the surrounding paragraph belongs
 * to the document, not to the paste — so it goes in as it is with a warning.
 */
function placeInsideParagraph(markup: string): PlacedMarkup {
  const elements = findTopLevelElementsMatching(markup, () => true);
  const [only] = elements;
  if (
    elements.length === 1 &&
    only.name === "p" &&
    only.start === 0 &&
    only.end === markup.length
  ) {
    return { markup: only.inner.trim() };
  }

  const stray = elements.filter(
    (element) => !PARAGRAPH_CONTENT_TAGS.has(element.name),
  );
  const block = stray.find((element) => element.name !== "p");
  const warnings: string[] = [];
  if (block) {
    warnings.push(
      `Pasted content produced a <${block.name}>, which cannot sit inside a <p>. ` +
        `It was inserted as-is — move it out of the paragraph to make the document valid.`,
    );
  }
  if (stray.some((element) => element.name === "p")) {
    warnings.push(
      `Pasted content produced more than one paragraph, which cannot sit inside a <p>. ` +
        `It was inserted as-is — split the surrounding paragraph to make the document valid.`,
    );
  }
  return {
    markup,
    warning: warnings.length > 0 ? warnings.join(" ") : undefined,
  };
}

/**
 * Fit converted markup to where it is going.
 *
 * Two adjustments, both about context rather than conversion. Inside a
 * paragraph the converter's own wrapping `<p>` is one paragraph too many, so it
 * is unwrapped; outside one, loose text that never got a `<p>` is given one.
 * What cannot be repaired here at all is block content landing inside a
 * paragraph — a division, or several paragraphs pasted into the middle of one.
 * The honest thing is to insert it and say so, leaving the author to move it,
 * rather than silently emitting invalid markup or refusing a paste they asked
 * for.
 */
export function placeConvertedMarkup(
  converted: string,
  context: PlacementContext,
): PlacedMarkup {
  const trimmed = converted.trim();
  const placed: PlacedMarkup = context.inline
    ? placeInsideParagraph(trimmed)
    : { markup: wrapLooseParagraphs(trimmed) };

  if (context.baseIndent) {
    placed.markup = reindentForContext(
      placed.markup,
      context.baseIndent,
      context.midLine,
    );
  }

  return placed;
}
