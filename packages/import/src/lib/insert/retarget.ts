// Retargeting an imported fragment onto a chosen division level (SPEC §9.3).
//
// A converted fragment's tags reflect its *source*, not its destination: a
// LaTeX `\section` yields `<section>`, a Markdown `#` yields `<chapter>`.
// Attaching that fragment as, say, a `<subsection>` of a host document means
// shifting every depth-indexed tag it contains by the same number of rungs.

import {
  DIVISION_LADDER,
  LADDER_OVERFLOW_TAG,
  ladderDepth,
  shiftLadderTag,
  type LadderTag,
  type PretextDivisionTag,
} from "../pretext-divisions";

import { findTagOccurrences } from "../layout/xml-scan";
import { spliceReplacements } from "../layout/shared";

export interface RetargetFragmentResult {
  /** The fragment with every ladder tag shifted. */
  source: string;
  /** Rungs each ladder tag moved down; 0 when the fragment was left alone. */
  delta: number;
  /** The shallowest ladder tag the fragment contained, if any. */
  topTag?: LadderTag;
  /** Distinct source tags that overflowed into `<paragraphs>`, shallowest first. */
  overflowed: LadderTag[];
}

/**
 * Split a tag name into its namespace prefix and local part, so the pool's
 * `<plus:subsection ref="…"/>` placeholders retarget alongside real elements.
 * The placeholders encode a division's *type* in their tag name, so leaving
 * them behind would desynchronize a pool from its own content.
 */
function splitTagName(name: string): { prefix: string; local: string } {
  const colon = name.indexOf(":");
  if (colon < 0) return { prefix: "", local: name };
  return {
    prefix: name.slice(0, colon + 1),
    local: name.slice(colon + 1),
  };
}

/**
 * Retarget `source` so its outermost division becomes `targetTag`.
 *
 * The delta is measured from the *shallowest* ladder tag anywhere in the
 * fragment, not from whatever happens to come first. That choice carries an
 * invariant worth having: since every other ladder tag is at least as deep as
 * the shallowest one, no tag is ever promoted above `targetTag`. Inserted
 * content can therefore only ever nest *inside* its attachment point — it can
 * never climb out of it and break the host document's structure.
 *
 * Off-ladder divisions (`<exercises>`, `<appendix>`, `<worksheet>`) pass
 * through untouched, and anything pushed past `<subsubsection>` becomes
 * `<paragraphs>`.
 */
export function retargetFragment(
  source: string,
  targetTag: PretextDivisionTag,
): RetargetFragmentResult {
  return retargetFragmentToDepth(source, ladderDepth(targetTag));
}

/**
 * `retargetFragment` by rung index rather than tag name. Inserting a document
 * *under* a division shifts its contents to the rung below, and below
 * `<subsubsection>` there is no tag to name — only overflow — so the depth
 * (which may be `DIVISION_LADDER.length`) says what no tag can.
 *
 * A negative depth means "no ladder target", and the fragment is left alone.
 */
export function retargetFragmentToDepth(
  source: string,
  targetDepth: number,
): RetargetFragmentResult {
  const tags = findTagOccurrences(source);

  // The shallowest ladder rung the fragment actually uses.
  let topDepth = -1;
  for (const tag of tags) {
    const depth = ladderDepth(splitTagName(tag.name).local);
    if (depth >= 0 && (topDepth < 0 || depth < topDepth)) topDepth = depth;
  }

  // Nothing depth-indexed to shift, or an off-ladder target (`<exercises>`,
  // `<appendix>`): the fragment keeps the levels it came with.
  if (topDepth < 0 || targetDepth < 0) {
    return { source, delta: 0, overflowed: [] };
  }

  const delta = targetDepth - topDepth;
  const topTag = DIVISION_LADDER[topDepth];
  if (delta === 0) {
    return { source, delta: 0, topTag, overflowed: [] };
  }

  const overflowedDepths = new Set<number>();
  const replacements: Array<{
    start: number;
    end: number;
    replacement: string;
  }> = [];

  for (const tag of tags) {
    const { prefix, local } = splitTagName(tag.name);
    const depth = ladderDepth(local);
    if (depth < 0) continue;

    const shifted = shiftLadderTag(local, delta);
    if (shifted === local) continue;
    if (shifted === LADDER_OVERFLOW_TAG) overflowedDepths.add(depth);

    // Rewrite only the tag name, leaving attributes and whitespace as they
    // were: the span is a single tag, so a name-anchored replace is safe.
    const text = source.slice(tag.start, tag.end);
    const renamed =
      tag.kind === "close"
        ? text.replace(/^<\/\s*[^\s>/]+/, `</${prefix}${shifted}`)
        : text.replace(/^<\s*[^\s>/]+/, `<${prefix}${shifted}`);
    replacements.push({ start: tag.start, end: tag.end, replacement: renamed });
  }

  const overflowed = [...overflowedDepths]
    .sort((a, b) => a - b)
    .map((depth) => DIVISION_LADDER[depth]);

  return {
    source: spliceReplacements(source, replacements),
    delta,
    topTag,
    overflowed,
  };
}
